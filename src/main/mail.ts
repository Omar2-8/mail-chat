import type {
  AttachmentInfo,
  ChatMessage,
  GroupSummary,
  NewThreadRequest,
  OutgoingAttachment,
  Person,
  PersonSuggestion,
  SendReplyRequest,
  SendResult,
  Settings,
  SyncState,
  ThreadBox,
  ThreadDetail,
  ThreadSummary,
  ThreadTag
} from '../shared/types';
import { Graph, GraphError, type GraphAddress, type GraphFolder, type GraphMessage, type UploadFile } from './graph';
import type { JsonFile, ThreadPrefs } from './store';
import { isVip, pausedReason, silenceReason, type NotifyFacts } from '../shared/notify';
import { buildSignature, type BuiltSignature } from './signature';
import { collapse, htmlToText, isForwardSubject, normalizeSubject, textToHtml } from './text';

const QUICK_SYNC_MS = 30_000;
const FULL_SYNC_MS = 10 * 60_000;
const QUICK_WINDOW_MS = 3 * 24 * 3600_000;
const QUICK_MAX = 150;
const INBOX_MAX = 2500;
const SENT_MAX = 1000;
const GROUP_MAX = 400;
const ARCHIVE_MAX = 300;
const DETAIL_TTL_MS = 20_000;
const MAX_INLINE_IMAGES = 15;
const MAX_INLINE_BYTES = 3 * 1024 * 1024;
const HIDDEN_FOLDERS = ['deleteditems', 'junkemail', 'drafts', 'outbox', 'conversationhistory', 'syncissues', 'scheduled', 'searchfolders', 'clutter'];
const HIDDEN_FOLDER_NAMES = /^(snoozed|rss feeds|rss subscriptions|sync issues|conversation history|notes|journal|tasks|calendar|contacts)$/i;
const BANNER_PREVIEW =
  /^\s*(?:\[?external\]?[:\s-]*)?(?:caution|warning|attention|external (?:email|sender|message))\s*[:!-]\s*(?:this|the) (?:e-?mail|message)[\s\S]{0,400}?(?:report|contact)[^.]{0,160}?@[\w.-]+\.\w+\.?\s*/i;
const BANNER_SENTENCE =
  /^\s*(?:\[?external\]?[:\s-]*)?(?:caution|warning|attention|external (?:email|sender|message))\s*[:!-]\s*(?:this|the) (?:e-?mail|message)[^.]{0,300}\.\s*/i;
const GREETING_PREVIEW = /^\s*(?:salam|salaam|assalamu? ?alaikum|hi|hello|hey|dear|good (?:morning|afternoon|evening)|مرحبا|السلام عليكم|اهلا|أهلا)\b[^,.!\n]{0,40}[,.!]\s*/i;

export interface IncomingNotice {
  threadId: string;
  subject: string;
  from: Person;
  preview: string;
}

export interface MailHooks {
  changed: () => void;
  threadChanged: (threadId: string) => void;
  incoming: (notices: IncomingNotice[]) => void;
  readFile: (path: string) => Promise<Buffer>;
}

interface DetailEntry {
  at: number;
  detail: ThreadDetail;
  raw: GraphMessage[];
}

export class MailService {
  private readonly messages = new Map<string, GraphMessage>();
  private readonly details = new Map<string, DetailEntry>();
  private readonly photos = new Map<string, Promise<string | null>>();
  private readonly notified = new Set<string>();
  private hiddenFolders = new Set<string>();
  private inboxId?: string;
  private archiveId?: string;
  private sentId?: string;
  private groupFolders = new Map<string, string>();
  private myAddresses = new Set<string>();
  private myDomains = new Set<string>();
  private meValue?: Person;
  private syncValue: SyncState;
  private quickTimer?: ReturnType<typeof setInterval>;
  private fullTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private syncing?: Promise<void>;
  private startedAt = Date.now();
  private primed = false;
  private threadCache?: ThreadSummary[];
  private readonly previews = new Map<string, string>();
  private enriching = false;

  constructor(
    private readonly graph: Graph,
    private readonly prefsFile: JsonFile<ThreadPrefs>,
    private prefs: ThreadPrefs,
    private settings: () => Settings,
    private readonly hooks: MailHooks
  ) {
    this.syncValue = { phase: 'idle', historyDays: settings().historyDays };
  }

  get me(): Person | undefined {
    return this.meValue;
  }

  get sync(): SyncState {
    return { ...this.syncValue, historyDays: this.settings().historyDays };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this.primed = false;
    this.setSync({ phase: 'loading', error: undefined });
    try {
      await this.loadIdentity();
      await this.fullSync();
    } catch (error) {
      this.setSync({ phase: phaseOf(error), error: messageOf(error) });
    }
    this.quickTimer = setInterval(() => void this.quickSync().catch(() => undefined), QUICK_SYNC_MS);
    this.fullTimer = setInterval(() => void this.fullSync().catch(() => undefined), FULL_SYNC_MS);
  }

  stop(): void {
    this.running = false;
    clearInterval(this.quickTimer);
    clearInterval(this.fullTimer);
    this.messages.clear();
    this.details.clear();
    this.photos.clear();
    this.previews.clear();
    this.threadCache = undefined;
    this.meValue = undefined;
    this.setSync({ phase: 'idle', lastSyncAt: undefined, error: undefined });
  }

  async refresh(): Promise<void> {
    if (!this.running) return;
    if (!this.meValue) await this.loadIdentity();
    await this.fullSync();
  }

  threads(): ThreadSummary[] {
    this.threadCache ??= this.buildThreads();
    return this.threadCache;
  }

  groups(): GroupSummary[] {
    const threads = this.threads();
    return [...this.groupFolders.entries()]
      .map(([id, name]) => {
        const inGroup = threads.filter((thread) => thread.groupId === id && !thread.archived);
        const latest = inGroup[0];
        return {
          id,
          name,
          silent: this.isGroupSilent(id),
          threadCount: inGroup.length,
          unreadThreads: inGroup.filter((thread) => thread.unreadCount > 0).length,
          lastActivity: latest?.lastActivity,
          latestSubject: latest?.subject,
          latestSender: latest ? (latest.lastFromMe ? 'You' : latest.lastSender.name) : undefined
        };
      })
      .sort((a, b) => Date.parse(b.lastActivity ?? '0') - Date.parse(a.lastActivity ?? '0') || a.name.localeCompare(b.name));
  }

  async setGroupSilent(groupId: string, silent: boolean): Promise<void> {
    this.prefs.groups[groupId] = { ...this.prefs.groups[groupId], silent };
    await this.savePrefs();
  }

  async createGroup(name: string): Promise<string> {
    const clean = name.trim().slice(0, 120);
    if (!clean) throw new Error('Give the group a name.');
    const folder = await this.graph.createFolder(clean);
    this.groupFolders.set(folder.id, folder.displayName ?? clean);
    this.prefs.groups[folder.id] = { silent: true };
    await this.savePrefs();
    return folder.id;
  }

  async moveToGroup(threadId: string, groupId: string | null): Promise<void> {
    const target = groupId ?? this.inboxId;
    if (!target) throw new Error('Inbox folder not found.');
    const current = await this.graph.conversation(threadId, false);
    const movable = current.filter(
      (message) => !message.isDraft && message.parentFolderId !== target && message.parentFolderId !== this.sentId && this.visible(message)
    );
    for (const message of movable) await this.graph.move(message.id, target);
    this.details.delete(threadId);
    await this.quickSync().catch(() => undefined);
    this.hooks.threadChanged(threadId);
  }

  async thread(threadId: string, fresh = false): Promise<ThreadDetail> {
    const cached = this.details.get(threadId);
    if (!fresh && cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.detail;
    const raw = (await this.graph.conversation(threadId)).filter((message) => this.visible(message));
    raw.sort((a, b) => timeOf(a) - timeOf(b));
    for (const message of raw) this.upsert(message);
    const detail = this.toDetail(threadId, raw);
    this.details.set(threadId, { at: Date.now(), detail, raw });
    this.invalidate();
    return detail;
  }

  async markRead(threadId: string): Promise<void> {
    const ids = this.conversationMessages(threadId)
      .filter((message) => !message.isRead)
      .map((message) => message.id);
    if (ids.length === 0) return;
    for (const id of ids) this.patchLocal(id, { isRead: true });
    this.invalidate();
    await this.graph.batchPatch(ids, { isRead: true });
  }

  async markUnread(threadId: string): Promise<void> {
    const incoming = this.conversationMessages(threadId).filter((message) => !this.isMine(message.from));
    const latest = incoming.sort((a, b) => timeOf(b) - timeOf(a))[0];
    if (!latest) return;
    this.patchLocal(latest.id, { isRead: false });
    this.invalidate();
    await this.graph.patchMessage(latest.id, { isRead: false });
  }

  async setPinned(threadId: string, pinned: boolean): Promise<void> {
    this.prefs.pinned = toggle(this.prefs.pinned, threadId, pinned);
    await this.savePrefs();
  }

  async setMuted(threadId: string, muted: boolean): Promise<void> {
    this.prefs.muted = toggle(this.prefs.muted, threadId, muted);
    await this.savePrefs();
  }

  async setArchived(threadId: string, archived: boolean): Promise<void> {
    if (archived) this.prefs.archived[threadId] = new Date().toISOString();
    else delete this.prefs.archived[threadId];
    if (archived) this.prefs.pinned = toggle(this.prefs.pinned, threadId, false);
    await this.savePrefs();
    const from = archived ? this.inboxId : this.archiveId;
    const to = archived ? this.archiveId : this.inboxId;
    if (!from || !to) return;
    const current = await this.graph.conversation(threadId, false);
    const movable = current.filter((message) => message.parentFolderId === from && !message.isDraft);
    for (const message of movable) await this.graph.move(message.id, to);
    if (movable.length > 0) void this.quickSync().catch(() => undefined);
  }

  async attachments(messageId: string): Promise<AttachmentInfo[]> {
    const items = await this.graph.attachments(messageId);
    return items.map((item) => ({
      id: item.id,
      name: item.name || 'attachment',
      size: item.size ?? 0,
      contentType: item.contentType || 'application/octet-stream',
      isInline: Boolean(item.isInline)
    }));
  }

  async inlineImages(messageId: string): Promise<Record<string, string>> {
    const items = (await this.graph.attachments(messageId)).filter(
      // Some senders attach inline pictures without the inline flag, so any small image can be a cid target.
      (item) => (item.contentType ?? '').startsWith('image/') && (item.size ?? 0) <= MAX_INLINE_BYTES
    );
    const images: Record<string, string> = {};
    for (const item of items.slice(0, MAX_INLINE_IMAGES)) {
      const full = await this.graph.attachment(messageId, item.id).catch(() => undefined);
      if (!full?.contentBytes) continue;
      const url = `data:${full.contentType || 'image/png'};base64,${full.contentBytes}`;
      if (full.contentId) images[full.contentId.replace(/^<|>$/g, '')] = url;
      if (full.name) images[`name:${full.name}`] = url;
    }
    return images;
  }

  attachmentBytes(messageId: string, attachmentId: string): Promise<Buffer> {
    return this.graph.attachmentBytes(messageId, attachmentId);
  }

  async sendReply(request: SendReplyRequest): Promise<SendResult> {
    try {
      const detail = await this.thread(request.threadId, true);
      const entry = this.details.get(request.threadId);
      const raw = entry?.raw ?? [];
      const chosen = request.replyToId ? raw.find((message) => message.id === request.replyToId) : undefined;
      const target =
        chosen ??
        (request.mode === 'sender'
          ? [...raw].reverse().find((message) => !this.isMine(message.from)) ?? raw[raw.length - 1]
          : raw[raw.length - 1]);
      if (!target) return { ok: false, error: 'This thread has no emails to reply to.' };
      const signature = buildSignature(this.settings());
      const draft = await this.graph.createReply(target.id, request.mode === 'all');
      const content = insertIntoBody(draft.body?.content ?? '', this.composeHtml(request.text, signature));
      await this.graph.patchMessage(draft.id, { body: { contentType: 'HTML', content } });
      await this.attach(draft.id, request.attachments, signature);
      await this.graph.send(draft.id);
      this.afterSend(detail.id);
      return { ok: true, threadId: detail.id };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  async sendNew(request: NewThreadRequest): Promise<SendResult> {
    try {
      const signature = buildSignature(this.settings());
      const draft = await this.graph.createDraft({
        subject: request.subject.trim(),
        body: { contentType: 'HTML', content: `<html><body>${this.composeHtml(request.text, signature)}</body></html>` },
        toRecipients: request.to.map(toAddress),
        ccRecipients: request.cc.map(toAddress)
      });
      await this.attach(draft.id, request.attachments, signature);
      await this.graph.send(draft.id);
      this.afterSend(draft.conversationId);
      return { ok: true, threadId: draft.conversationId };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  async searchPeople(query: string): Promise<PersonSuggestion[]> {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const found = new Map<string, PersonSuggestion>();
    const add = (person: Person, source: PersonSuggestion['source']) => {
      const email = person.email.trim().toLowerCase();
      if (!email || this.myAddresses.has(email) || found.has(email)) return;
      found.set(email, { name: person.name || person.email, email: person.email.trim(), source });
    };
    for (const person of this.recentPeople()) {
      if (person.name.toLowerCase().includes(term) || person.email.toLowerCase().includes(term)) add(person, 'recent');
      if (found.size >= 5) break;
    }
    const [people, users] = await Promise.all([
      this.graph.people(term).catch(() => []),
      term.length >= 2 ? this.graph.users(term).catch(() => []) : Promise.resolve([])
    ]);
    for (const person of people) {
      const email = person.scoredEmailAddresses?.[0]?.address;
      if (email) add({ name: person.displayName ?? email, email }, 'people');
    }
    for (const user of users) {
      const email = user.mail || user.userPrincipalName;
      if (email) add({ name: user.displayName ?? email, email }, 'directory');
    }
    return [...found.values()].slice(0, 10);
  }

  photo(email: string): Promise<string | null> {
    const key = email.trim().toLowerCase();
    if (!key) return Promise.resolve(null);
    let pending = this.photos.get(key);
    if (!pending) {
      pending = this.graph
        .photo(key)
        .then((bytes) => (bytes && bytes.length > 0 ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null))
        .catch(() => {
          this.photos.delete(key);
          return null;
        });
      this.photos.set(key, pending);
    }
    return pending;
  }

  transcript(threadId: string, messageId?: string): { subject: string; text: string } | undefined {
    const entry = this.details.get(threadId);
    if (!entry) return undefined;
    const raw = messageId ? entry.raw.filter((message) => message.id === messageId) : entry.raw;
    const newest = raw[raw.length - 1];
    const quoted = newest ? htmlToText(newest.body?.content ?? '') : '';
    const ownText = newest ? htmlToText(newest.uniqueBody?.content ?? '') : '';
    const history = quoted.length > ownText.length + 200 ? `Older emails quoted inside the newest email (oldest history at the bottom):\n\n${quoted.slice(0, 30_000)}` : '';
    const parts = raw.map((message) => {
      const from = personOf(message.from);
      const to = (message.toRecipients ?? []).map(personOf).map(label).join(', ');
      const cc = (message.ccRecipients ?? []).map(personOf).map(label).join(', ');
      const body = htmlToText(message.uniqueBody?.content || message.body?.content || '');
      const header = [
        `From: ${label(from)}${this.isMine(message.from) ? ' (this is the user)' : ''}`,
        `Date: ${new Date(timeOf(message)).toUTCString()}`,
        to ? `To: ${to}` : '',
        cc ? `Cc: ${cc}` : ''
      ]
        .filter(Boolean)
        .join('\n');
      return `${header}\n\n${body.slice(0, 12_000)}`;
    });
    const text = [history, ...parts].filter(Boolean).join('\n\n-----\n\n');
    return { subject: entry.detail.subject, text: text.slice(0, 70_000) };
  }

  private async loadIdentity(): Promise<void> {
    const me = await this.graph.me();
    const email = me.mail || me.userPrincipalName || '';
    this.meValue = { name: me.displayName || email, email };
    const aliases = await this.graph.proxyAddresses();
    this.myAddresses = new Set([email, me.userPrincipalName ?? '', ...aliases].filter(Boolean).map((value) => value.toLowerCase()));
    this.myDomains = new Set([...this.myAddresses].map((address) => address.split('@')[1]).filter(Boolean));
    const ids = await Promise.all(HIDDEN_FOLDERS.map((name) => this.graph.folderId(name)));
    this.hiddenFolders = new Set(ids.filter((id): id is string => Boolean(id)));
    [this.inboxId, this.archiveId, this.sentId] = await Promise.all([
      this.graph.folderId('inbox'),
      this.graph.folderId('archive'),
      this.graph.folderId('sentitems')
    ]);
    await this.loadFolders();
  }

  private async loadFolders(): Promise<void> {
    const folders = await this.graph.folders().catch(() => [] as GraphFolder[]);
    const system = new Set([this.inboxId, this.archiveId, this.sentId, ...this.hiddenFolders].filter(Boolean));
    const hiddenParents = new Set<string>();
    const groups = new Map<string, string>();
    let imported = false;
    for (const folder of folders) {
      const name = (folder.displayName ?? '').trim();
      if (system.has(folder.id)) continue;
      if (HIDDEN_FOLDER_NAMES.test(name) || (folder.parentFolderId && hiddenParents.has(folder.parentFolderId))) {
        hiddenParents.add(folder.id);
        this.hiddenFolders.add(folder.id);
        continue;
      }
      if (folder.parentFolderId && this.hiddenFolders.has(folder.parentFolderId)) {
        this.hiddenFolders.add(folder.id);
        continue;
      }
      const label = folder.parentFolderId === this.inboxId ? name : (folder.path ?? name).replace(/^Inbox \/ /, '');
      groups.set(folder.id, label || 'Folder');
      if (!this.prefs.groups[folder.id]) {
        this.prefs.groups[folder.id] = { silent: true };
        imported = true;
      }
    }
    this.groupFolders = groups;
    if (imported) await this.prefsFile.save(this.prefs);
  }

  private fullSync(): Promise<void> {
    return this.exclusive(async () => {
      const days = this.settings().historyDays;
      const since = new Date(Date.now() - days * 24 * 3600_000);
      await this.loadFolders();
      const plan: [string | undefined, number][] = [
        [this.inboxId, INBOX_MAX],
        [this.sentId, SENT_MAX],
        [this.archiveId, ARCHIVE_MAX],
        ...[...this.groupFolders.keys()].map((id): [string, number] => [id, GROUP_MAX])
      ];
      const failed = new Set<string>();
      const batches = await Promise.all(
        plan
          .filter((entry): entry is [string, number] => Boolean(entry[0]))
          .map(([id, max]) =>
            this.graph.folderMessages(id, since, max).catch(() => {
              failed.add(id);
              return [] as GraphMessage[];
            })
          )
      );
      const unique = new Map<string, GraphMessage>();
      for (const message of batches.flat()) unique.set(message.id, message);
      const fetched = [...unique.values()];
      const before = new Set(this.messages.keys());
      const kept = [...this.messages.values()].filter((message) => message.parentFolderId && failed.has(message.parentFolderId) && !unique.has(message.id));
      this.messages.clear();
      for (const message of kept) this.messages.set(message.id, message);
      for (const message of fetched) this.messages.set(message.id, message);
      this.announce(fetched.filter((message) => !before.has(message.id)));
      this.primed = true;
      void this.enrichPreviews();
    });
  }

  private quickSync(): Promise<void> {
    return this.exclusive(async () => {
      const since = new Date(Date.now() - QUICK_WINDOW_MS);
      const fetched = await this.graph.recentMessages(since, QUICK_MAX);
      const windowStart = fetched.length >= QUICK_MAX ? timeOf(fetched[fetched.length - 1]) : since.getTime();
      const seen = new Set(fetched.map((message) => message.id));
      const fresh = fetched.filter((message) => !this.messages.has(message.id));
      const changedThreads = new Set<string>();
      for (const [id, message] of this.messages) {
        if (timeOf(message) >= windowStart && !seen.has(id)) {
          this.messages.delete(id);
          changedThreads.add(message.conversationId);
        }
      }
      for (const message of fetched) {
        const previous = this.messages.get(message.id);
        if (!previous || previous.isRead !== message.isRead || previous.parentFolderId !== message.parentFolderId) {
          changedThreads.add(message.conversationId);
        }
        this.messages.set(message.id, message);
      }
      for (const threadId of changedThreads) {
        this.details.delete(threadId);
        this.hooks.threadChanged(threadId);
      }
      this.announce(fresh);
      void this.enrichPreviews();
    });
  }

  private async exclusive(work: () => Promise<void>): Promise<void> {
    if (this.syncing) return this.syncing;
    if (!this.running) return;
    this.setSync({ phase: this.primed ? 'syncing' : 'loading' });
    this.syncing = work()
      .then(() => {
        this.invalidate();
        this.setSync({ phase: 'idle', lastSyncAt: new Date().toISOString(), error: undefined });
      })
      .catch((error: unknown) => {
        this.setSync({ phase: phaseOf(error), error: messageOf(error) });
        throw error;
      })
      .finally(() => {
        this.syncing = undefined;
      });
    return this.syncing;
  }

  private announce(fresh: GraphMessage[]): void {
    if (!this.primed) return;
    const notices: IncomingNotice[] = [];
    for (const message of fresh) {
      const key = `${message.conversationId}|${message.receivedDateTime}|${message.from?.emailAddress?.address}`;
      if (this.notified.has(key)) continue;
      this.notified.add(key);
      if (message.isRead || !this.visible(message) || this.isMine(message.from)) continue;
      if (timeOf(message) < this.startedAt - 60_000) continue;
      if (this.prefs.muted.includes(message.conversationId)) continue;
      const settings = this.settings();
      const facts = this.factsOf(message);
      if (!settings.notifications) continue;
      if (message.parentFolderId && this.groupFolders.has(message.parentFolderId) && this.isGroupSilent(message.parentFolderId)) continue;
      if (!isVip(settings, facts.email) && (pausedReason(settings) || silenceReason(settings, facts))) continue;
      notices.push({
        threadId: message.conversationId,
        subject: normalizeSubject(message.subject),
        from: personOf(message.from),
        preview: cleanPreview(message.bodyPreview)
      });
    }
    if (notices.length > 0) this.hooks.incoming(notices);
  }

  private buildThreads(): ThreadSummary[] {
    const groups = new Map<string, GraphMessage[]>();
    for (const message of this.messages.values()) {
      if (!this.visible(message)) continue;
      const list = groups.get(message.conversationId);
      if (list) list.push(message);
      else groups.set(message.conversationId, [message]);
    }
    const threads: ThreadSummary[] = [];
    for (const [id, list] of groups) {
      list.sort((a, b) => timeOf(b) - timeOf(a));
      threads.push(this.summarize(id, list));
    }
    return threads.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.lastActivity) - Date.parse(a.lastActivity));
  }

  private summarize(id: string, list: GraphMessage[]): ThreadSummary {
    const latest = list[0];
    const latestIncoming = list.find((message) => !this.isMine(message.from));
    const participants = this.participantsOf(list);
    const tags: ThreadTag[] = [];
    if (latestIncoming && !this.addressedTo(latestIncoming)) tags.push('fyi');
    if (list.some((message) => (message['@odata.type'] ?? '').includes('eventMessage'))) tags.push('meeting');
    if (list.some((message) => message.importance === 'high' && !message.isRead)) tags.push('important');
    if (list.some((message) => message.hasAttachments)) tags.push('attachment');
    if (participants.some((person) => this.isExternal(person.email))) tags.push('external');
    const archivedAt = this.prefs.archived[id];
    const lastActivity = new Date(timeOf(latest)).toISOString();
    const anchor = latestIncoming ?? latest;
    const groupId = anchor.parentFolderId && this.groupFolders.has(anchor.parentFolderId) ? anchor.parentFolderId : undefined;
    const archivedInOutlook = Boolean(this.archiveId) && anchor.parentFolderId === this.archiveId;
    const box: ThreadBox = latestIncoming?.inferenceClassification === 'other' ? 'other' : 'focused';
    return {
      id,
      subject: normalizeSubject(list.find((message) => message.subject)?.subject),
      lastActivity,
      lastSender: personOf(latest.from),
      lastFromMe: this.isMine(latest.from),
      preview: this.previews.get(latest.id) ?? cleanPreview(latest.bodyPreview),
      unreadCount: list.filter((message) => !message.isRead && !this.isMine(message.from)).length,
      messageCount: list.length,
      participants,
      tags,
      box,
      pinned: this.prefs.pinned.includes(id),
      muted: this.prefs.muted.includes(id),
      silenced:
        groupId && this.isGroupSilent(groupId)
          ? `The "${this.groupFolders.get(groupId)}" group is silent`
          : latestIncoming
            ? silenceReason(this.settings(), this.factsOf(latestIncoming))
            : undefined,
      archived: archivedInOutlook || (Boolean(archivedAt) && Date.parse(archivedAt) >= Date.parse(lastActivity)),
      groupId,
      groupName: groupId ? this.groupFolders.get(groupId) : undefined,
      webLink: latest.webLink ?? undefined
    };
  }

  private toDetail(threadId: string, raw: GraphMessage[]): ThreadDetail {
    const messages: ChatMessage[] = raw.map((message) => {
      const type = message['@odata.type'] ?? '';
      const unique = message.uniqueBody?.content ?? '';
      const full = message.body?.content ?? '';
      return {
        id: message.id,
        threadId,
        from: personOf(message.from),
        fromMe: this.isMine(message.from),
        to: (message.toRecipients ?? []).map(personOf),
        cc: (message.ccRecipients ?? []).map(personOf),
        sentAt: new Date(timeOf(message)).toISOString(),
        isRead: Boolean(message.isRead),
        kind: type.includes('eventMessage') ? 'meeting' : isForwardSubject(message.subject) ? 'forward' : 'mail',
        subject: message.subject ?? '',
        html: htmlToText(unique).length > 0 ? unique : full,
        fullHtml: full,
        preview: cleanPreview(message.bodyPreview),
        hasAttachments: Boolean(message.hasAttachments),
        importance: message.importance === 'high' ? 'high' : message.importance === 'low' ? 'low' : 'normal',
        webLink: message.webLink ?? undefined
      };
    });
    const subject = normalizeSubject(raw.find((message) => message.subject)?.subject ?? this.threads().find((t) => t.id === threadId)?.subject);
    return { id: threadId, subject, messages, participants: this.participantsOf(raw) };
  }

  private factsOf(message: GraphMessage): NotifyFacts {
    const from = personOf(message.from);
    return {
      email: from.email,
      name: from.name,
      subject: message.subject ?? '',
      preview: message.bodyPreview ?? '',
      other: message.inferenceClassification === 'other',
      addressedToMe: this.addressedTo(message),
      external: this.isExternal(from.email),
      meeting: (message['@odata.type'] ?? '').includes('eventMessage')
    };
  }

  rulesChanged(): void {
    this.invalidate();
  }

  private participantsOf(list: GraphMessage[]): Person[] {
    const people = new Map<string, Person>();
    for (const message of list) {
      for (const address of [message.from, ...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])]) {
        const person = personOf(address);
        const key = person.email.toLowerCase();
        if (!key || this.myAddresses.has(key)) continue;
        const existing = people.get(key);
        if (!existing || (existing.name === existing.email && person.name !== person.email)) people.set(key, person);
      }
    }
    return [...people.values()];
  }

  private recentPeople(): Person[] {
    const people = new Map<string, Person>();
    const sorted = [...this.messages.values()].sort((a, b) => timeOf(b) - timeOf(a));
    for (const message of sorted) {
      for (const address of [message.from, ...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])]) {
        const person = personOf(address);
        const key = person.email.toLowerCase();
        if (key && !people.has(key)) people.set(key, person);
      }
    }
    return [...people.values()];
  }

  private conversationMessages(threadId: string): GraphMessage[] {
    const byId = new Map<string, GraphMessage>();
    for (const message of this.details.get(threadId)?.raw ?? []) byId.set(message.id, message);
    for (const message of this.messages.values()) if (message.conversationId === threadId) byId.set(message.id, message);
    return [...byId.values()].filter((message) => this.visible(message));
  }

  private patchLocal(id: string, patch: Partial<GraphMessage>): void {
    const message = this.messages.get(id);
    if (message) this.messages.set(id, { ...message, ...patch });
    for (const entry of this.details.values()) {
      const index = entry.raw.findIndex((item) => item.id === id);
      if (index < 0) continue;
      entry.raw[index] = { ...entry.raw[index], ...patch };
      entry.detail = { ...entry.detail, messages: entry.detail.messages.map((m) => (m.id === id ? { ...m, isRead: patch.isRead ?? m.isRead } : m)) };
    }
  }

  private upsert(message: GraphMessage): void {
    const { uniqueBody: _unique, body: _body, ...rest } = message;
    this.messages.set(message.id, { ...this.messages.get(message.id), ...rest });
  }

  private isGroupSilent(groupId: string): boolean {
    return this.prefs.groups[groupId]?.silent ?? true;
  }

  private visible(message: GraphMessage): boolean {
    return !message.isDraft && !(message.parentFolderId && this.hiddenFolders.has(message.parentFolderId));
  }

  private isMine(address: GraphAddress | null | undefined): boolean {
    const email = address?.emailAddress?.address?.toLowerCase();
    return Boolean(email && this.myAddresses.has(email));
  }

  private addressedTo(message: GraphMessage): boolean {
    return (message.toRecipients ?? []).some((recipient) => this.isMine(recipient));
  }

  private isExternal(email: string): boolean {
    const domain = email.split('@')[1]?.toLowerCase();
    return Boolean(domain) && this.myDomains.size > 0 && !this.myDomains.has(domain);
  }

  private composeHtml(text: string, signature: BuiltSignature): string {
    const body = `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt">${textToHtml(text.trim())}</div>`;
    return signature.html ? `${body}<br>${signature.html}<br>` : `${body}<br>`;
  }

  private async attach(messageId: string, files: OutgoingAttachment[], signature: BuiltSignature): Promise<void> {
    for (const image of signature.images) await this.graph.addInlineImage(messageId, image);
    for (const file of files) {
      const upload: UploadFile = { name: file.name, size: file.size, read: () => this.hooks.readFile(file.path) };
      await this.graph.addAttachment(messageId, upload);
    }
  }

  private afterSend(threadId: string): void {
    this.details.delete(threadId);
    setTimeout(() => void this.quickSync().then(() => this.hooks.threadChanged(threadId), () => undefined), 2500);
    setTimeout(() => void this.quickSync().then(() => this.hooks.threadChanged(threadId), () => undefined), 8000);
  }

  private async savePrefs(): Promise<void> {
    this.invalidate();
    await this.prefsFile.save(this.prefs);
  }

  private async enrichPreviews(): Promise<void> {
    if (this.enriching) return;
    this.enriching = true;
    try {
      const latest = new Map<string, GraphMessage>();
      for (const message of this.messages.values()) {
        if (!this.visible(message)) continue;
        const current = latest.get(message.conversationId);
        if (!current || timeOf(message) > timeOf(current)) latest.set(message.conversationId, message);
      }
      const needed = [...latest.values()]
        .filter((message) => !this.previews.has(message.id) && needsBody(message.bodyPreview))
        .sort((a, b) => timeOf(b) - timeOf(a))
        .slice(0, 80);
      if (needed.length === 0) return;
      const bodies = await this.graph.uniqueBodies(needed.map((message) => message.id));
      for (const message of needed) {
        const text = bodies.get(message.id);
        if (text === undefined) continue;
        const preview = cleanPreview(text.replace(/\r?\n/g, ' '));
        this.previews.set(message.id, preview || cleanPreview(message.bodyPreview));
      }
      this.invalidate();
    } catch {
      return;
    } finally {
      this.enriching = false;
    }
  }

  private invalidate(): void {
    this.threadCache = undefined;
    this.hooks.changed();
  }

  private setSync(patch: Partial<SyncState>): void {
    this.syncValue = { ...this.syncValue, ...patch };
    this.hooks.changed();
  }
}

function insertIntoBody(document: string, html: string): string {
  const match = /<body[^>]*>/i.exec(document);
  if (!match) return `${html}${document}`;
  const at = match.index + match[0].length;
  return `${document.slice(0, at)}${html}${document.slice(at)}`;
}

function toAddress(person: Person): GraphAddress {
  return { emailAddress: { name: person.name || person.email, address: person.email } };
}

function personOf(address: GraphAddress | null | undefined): Person {
  const email = address?.emailAddress?.address?.trim() ?? '';
  const name = address?.emailAddress?.name?.trim() || email || 'Unknown';
  return { name: name.replace(/^'+|'+$/g, ''), email };
}

function label(person: Person): string {
  return person.email && person.email !== person.name ? `${person.name} <${person.email}>` : person.name;
}

function timeOf(message: GraphMessage): number {
  return Date.parse(message.receivedDateTime || message.sentDateTime || '') || 0;
}

function needsBody(preview: string | null | undefined): boolean {
  const raw = collapse(preview);
  return BANNER_SENTENCE.test(raw) || cleanPreview(raw).length < 25;
}

function cleanPreview(preview: string | null | undefined): string {
  const collapsed = collapse((preview ?? '').replace(/<(?:mailto:|https?:\/\/)[^>]*>/gi, ''));
  const text = (BANNER_PREVIEW.test(collapsed) ? collapsed.replace(BANNER_PREVIEW, '') : collapsed.replace(BANNER_SENTENCE, '')).replace(GREETING_PREVIEW, '');
  return text.slice(0, 220);
}

function toggle(list: string[], id: string, on: boolean): string[] {
  const without = list.filter((item) => item !== id);
  return on ? [...without, id] : without;
}

function phaseOf(error: unknown): SyncState['phase'] {
  if (error instanceof GraphError && error.status === 0) return 'offline';
  return 'error';
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
