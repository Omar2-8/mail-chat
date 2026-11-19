import type { AiStatus, MailChatApi } from '../../shared/ipc';
import type { AppEvent, AppSnapshot, AuthErrorInfo, ChatMessage, Person, Settings, ThreadDetail, ThreadSummary } from '../../shared/types';

const ME: Person = { name: 'Alex Morgan', email: 'alex@example.com' };
const P = {
  sara: { name: 'Maya Lindqvist', email: 'maya.lindqvist@northwind.example' },
  dan: { name: 'Ben Carter', email: 'ben.carter@northwind.example' },
  lina: { name: 'Chloe Park', email: 'chloe.park@northwind.example' },
  khaled: { name: 'Ravi Kapoor', email: 'ravi.kapoor@northwind.example' },
  priya: { name: 'Nora Quinn', email: 'nora.quinn@northwind.example' },
  ops: { name: 'Ops Alerts', email: 'alerts@monitoring.example.com' },
  vendor: { name: 'Greg Holloway', email: 'greg.holloway@vendor.example.com' },
  hr: { name: 'People Team', email: 'people@northwind.example' },
  news: { name: 'Dev Weekly', email: 'news@devweekly.example.com' }
};

const SETTINGS: Settings = {
  historyDays: 30,
  signature: 'Alex Morgan\nSoftware Engineer · Northwind Labs',
  signatureMode: 'simple',
  signatureHtml: '',
  signatureSource: '',
  signatureLogo: '',
  signatureLogoHeight: 48,
  signatureLogoRatio: 1,
  signatureLogoLink: '',
  signatureLayout: 'below',
  notifications: true,
  dndUntil: '',
  quietHours: false,
  quietFrom: '19:00',
  quietTo: '08:00',
  quietDays: [],
  silenceOther: true,
  silenceFyi: false,
  silenceExternal: false,
  silenceMeetings: false,
  silenceAutomated: false,
  mutedSenders: [],
  mutedKeywords: [],
  vipSenders: [],
  startWithWindows: false,
  closeToTray: true,
  aiEnabled: true,
  aiModel: 'haiku',
  claudePath: '',
  theme: 'system',
  defaultReplyMode: 'all',
  chatTrim: true
};

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

let ids = 0;

function msg(threadId: string, from: Person, to: Person[], cc: Person[], minutesAgo: number, html: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  const fromMe = from.email === ME.email;
  return {
    id: `m${++ids}`,
    threadId,
    from,
    fromMe,
    to,
    cc,
    sentAt: ago(minutesAgo),
    isRead: fromMe || minutesAgo > 200,
    kind: 'mail',
    subject: '',
    html,
    fullHtml: `${html}<hr><p><b>From:</b> earlier messages…</p>`,
    preview: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
    hasAttachments: false,
    importance: 'normal',
    ...extra
  };
}

function build(): Map<string, { detail: ThreadDetail; summary: ThreadSummary }> {
  const threads = new Map<string, { detail: ThreadDetail; summary: ThreadSummary }>();
  const add = (id: string, subject: string, messages: ChatMessage[], extra: Partial<ThreadSummary> = {}) => {
    const people = new Map<string, Person>();
    for (const m of messages) for (const p of [m.from, ...m.to, ...m.cc]) if (p.email !== ME.email) people.set(p.email, p);
    const last = messages[messages.length - 1];
    const lastIncoming = [...messages].reverse().find((m) => !m.fromMe);
    const tags: ThreadSummary['tags'] = [];
    if (lastIncoming && !lastIncoming.to.some((p) => p.email === ME.email)) tags.push('fyi');
    if (messages.some((m) => m.kind === 'meeting')) tags.push('meeting');
    if (messages.some((m) => m.hasAttachments)) tags.push('attachment');
    if ([...people.values()].some((p) => !p.email.endsWith('northwind.example'))) tags.push('external');
    if (messages.some((m) => m.importance === 'high' && !m.isRead)) tags.push('important');
    const detail: ThreadDetail = { id, subject, messages, participants: [...people.values()] };
    threads.set(id, {
      detail,
      summary: {
        id,
        subject,
        lastActivity: last.sentAt,
        lastSender: last.from,
        lastFromMe: last.fromMe,
        preview: last.preview,
        unreadCount: messages.filter((m) => !m.isRead && !m.fromMe).length,
        messageCount: messages.length,
        participants: [...people.values()],
        tags,
        box: 'focused',
        pinned: false,
        muted: false,
        archived: false,
        webLink: 'https://outlook.office.com/mail/',
        ...extra
      }
    });
  };

  add('t1', 'Release plan for Thursday', [
    msg('t1', P.sara, [ME, P.dan], [P.lina], 60 * 26, `<p>Hi all,</p><p>Sharing the draft release plan for Thursday. Please review the attached checklist and confirm your items by <b>Wednesday 3 PM</b>.</p><ul><li>Backend: migrations + feature flags</li><li>Frontend: new onboarding screen</li><li>QA: regression on sign-in flows</li></ul><p>Thanks,<br>Maya</p>`, { hasAttachments: true, isRead: true }),
    msg('t1', P.dan, [P.sara], [ME, P.lina], 60 * 25, `<p>Backend is fine on my side. One concern: the migration on <span style="color:#d13438"><b>Analytics</b></span> took 9 minutes on staging, we should run it by hand before the deploy.</p>`, { isRead: true }),
    msg('t1', ME, [P.sara, P.dan], [P.lina], 60 * 24, `<p>Agreed with Ben. I can run the ALTER manually Wednesday night. FE screen is ready, PR is up.</p>`),
    msg('t1', P.sara, [ME, P.dan, P.khaled], [P.lina, P.priya], 95, `<p>Great, thanks both. Adding Ravi (DB) and Nora (QA) so they're in the loop.</p><p>@Alex can you share the exact SQL with Ravi <b>before 6 PM today</b>?</p>`, { isRead: false }),
    msg('t1', P.khaled, [P.sara, ME], [P.dan, P.lina, P.priya], 12, `<p>Yes please send it over, I'll schedule it for the 22:00 window. Also need the rollback script.</p>`, { isRead: false })
  ]);

  add('t2', 'URGENT: Staging sync failures since 09:40', [
    msg('t2', P.ops, [ME], [], 40, `<p><b>Alert:</b> 412 failed pushes to the partner API in the last 30 minutes.</p><table><tr><th>Entity</th><th>Failures</th></tr><tr><td>Profiles</td><td style="background-color:#fde7e9">398</td></tr><tr><td>Settings</td><td>14</td></tr></table>`, { importance: 'high', isRead: false }),
    msg('t2', P.dan, [ME], [P.sara], 28, `<p>Seeing the same in logs, looks like 500s from their side again. Want to jump on a call?</p>`, { isRead: false })
  ]);

  add('t3', 'Lunch Thursday? 🍕', [
    msg('t3', P.lina, [ME, P.priya], [], 300, `<p>Team lunch after the release? Thinking the pizza place downstairs.</p>`),
    msg('t3', P.priya, [P.lina, ME], [], 280, `<p>I'm in!!</p>`),
    msg('t3', ME, [P.lina, P.priya], [], 270, `<p>Count me in 🙌</p>`)
  ]);

  add(
    't4',
    'Quarterly security training reminder',
    [msg('t4', P.hr, [{ name: 'All Staff', email: 'all@northwind.example' }], [ME], 60 * 30, `<p>Dear colleagues,</p><p>This is a kind reminder that the quarterly security awareness training must be completed by <b>31 October</b>. It takes around 20 minutes.</p><p>Kind regards,<br>People Team</p>`)],
    {}
  );

  add('t5', 'Contract renewal – API gateway licenses', [
    msg('t5', P.vendor, [ME], [P.sara], 60 * 50, `<p>Hello Alex,</p><p>Following up on our previous correspondence regarding the renewal of your API gateway licenses. As per my last email, the current agreement expires on 15 November. Kindly advise at your earliest convenience whether you intend to proceed with the renewal under the revised terms outlined in the attached proposal.</p><p>Best regards,<br>Greg</p>`, { hasAttachments: true, isRead: true }),
    msg('t5', P.vendor, [ME], [P.sara], 60 * 3, `<p>Hi Alex, just bumping this up. We'd need a decision by Friday to avoid a lapse in service.</p>`, { isRead: false })
  ]);

  add('t6', 'Sprint review', [
    msg('t6', P.priya, [ME, P.dan, P.sara], [], 60 * 6, `<p><b>Sprint review</b><br>When: Thursday 2:00 PM – 3:00 PM<br>Where: Teams meeting</p><p>Demo your stories please 🙏</p>`, { kind: 'meeting', subject: 'Invitation: Sprint review', isRead: true })
  ]);

  add('t7', 'تحديث بخصوص أذونات المستخدمين', [
    msg('t7', P.khaled, [ME], [], 60 * 9, `<p dir="rtl">مرحباً أليكس،</p><p dir="rtl">تمت إضافة صلاحية المعالجة لـ 163 مستخدم. هل يمكنك التأكد من ظهور القائمة لديهم؟</p><p dir="rtl">شكراً</p>`, { isRead: true })
  ]);

  add('t9', 'PR - Show author and reviewer names', [msg('t9', { name: 'Build Bot', email: 'builds@ci.example' }, [ME], [], 60 * 20, `<p>Sam Rivera completed the pull request.</p>`, { isRead: false })], { groupId: 'g1', groupName: 'Build alerts', silenced: 'The "Build alerts" group is silent' });
  add('t10', 'Build 2026.10.18.3 succeeded', [msg('t10', { name: 'Build Bot', email: 'builds@ci.example' }, [ME], [], 60 * 26, `<p>Pipeline WebApp-API succeeded.</p>`, { isRead: false })], { groupId: 'g1', groupName: 'Build alerts', silenced: 'The "Build alerts" group is silent' });
  add('t11', 'Your Skyline Cloud receipt for October', [msg('t11', { name: 'Skyline Cloud', email: 'billing@skyline.example' }, [ME], [], 60 * 50, `<p>Your payment was received.</p>`)], { groupId: 'g2', groupName: 'Receipts', silenced: 'The "Receipts" group is silent' });

  add('t8', 'This week in dev tools: bundlers get faster', [msg('t8', P.news, [ME], [], 60 * 12, `<p>Top stories this week…</p>`, { isRead: false })], {
    box: 'other',
    silenced: 'Newsletters and bots are silenced'
  });

  return threads;
}

function mockAuthError(name: string | null): AuthErrorInfo | undefined {
  const details = (code: string, message: string, kind: string) =>
    [
      'Mail Chat sign-in details',
      `Error codes: ${code}`,
      `Message: ${message}`,
      `Account type tried: ${kind}`,
      'Sign-in method: browser',
      'Authority: https://login.microsoftonline.com/organizations',
      'Client ID: c013199a-9f43-4212-b949-c8633efb8146',
      'App version: 0.0.0-preview',
      'Platform: win32 x64'
    ].join('\n');
  switch (name) {
    case 'admin':
      return {
        title: 'Your organization needs to approve Mail Chat',
        hint: 'Ask your IT admin to approve Mail Chat and send them the details below. This is not a problem with your password.',
        code: 'AADSTS65001',
        details: details('AADSTS65001', 'The user or administrator has not consented to use the application.', 'work or school')
      };
    case 'blocked':
      return {
        title: 'Your organization does not allow Mail Chat on this device or network',
        hint: 'A security rule blocked this sign-in. Try your usual work device or network, or ask your IT team and send them the details below.',
        code: 'AADSTS53003',
        details: details('AADSTS53003', 'Access has been blocked by Conditional Access policies.', 'work or school')
      };
    case 'network':
      return {
        title: 'Could not reach Microsoft',
        hint: 'Check your internet connection, VPN or proxy, then try again.',
        code: 'ENOTFOUND',
        details: details('ENOTFOUND', 'getaddrinfo ENOTFOUND login.microsoftonline.com', 'work or school')
      };
    case 'wrongaccount':
      return {
        title: 'This account does not match the button you used',
        hint: 'Try the personal account button instead.',
        code: 'AADSTS50020',
        details: details('AADSTS50020', 'User account does not exist in tenant.', 'work or school')
      };
    default:
      return undefined;
  }
}

export function createMockApi(): MailChatApi {
  const store = build();
  const listeners = new Set<(event: AppEvent) => void>();
  let settings = { ...SETTINGS };
  let signedIn = !new URLSearchParams(location.search).has('signin');
  let busy = false;
  let errorInfo = signedIn ? undefined : mockAuthError(new URLSearchParams(location.search).get('error'));

  const snapshot = (): AppSnapshot => ({
    auth: { signedIn, busy, account: signedIn ? ME : undefined, error: errorInfo?.title, errorInfo },
    sync: { phase: 'idle', lastSyncAt: new Date().toISOString(), historyDays: settings.historyDays },
    settings,
    groups: groupsOf(),
    me: signedIn ? ME : undefined,
    threads: [...store.values()]
      .map((entry) => entry.summary)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.lastActivity) - Date.parse(a.lastActivity))
  });
  const groupSilent: Record<string, boolean> = { g1: true, g2: true };
  const groupNames: Record<string, string> = { g1: 'Build alerts', g2: 'Receipts' };
  const groupsOf = () =>
    Object.keys(groupNames).map((id) => {
      const list = [...store.values()].map((entry) => entry.summary).filter((t) => t.groupId === id).sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity));
      return {
        id,
        name: groupNames[id],
        silent: groupSilent[id],
        threadCount: list.length,
        unreadThreads: list.filter((t) => t.unreadCount > 0).length,
        lastActivity: list[0]?.lastActivity,
        latestSubject: list[0]?.subject,
        latestSender: list[0]?.lastSender.name
      };
    });
  const emit = (event: AppEvent) => listeners.forEach((listener) => listener(event));
  const changed = () => emit({ type: 'snapshot', snapshot: snapshot() });
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const entry = (id: string) => {
    const found = store.get(id);
    if (!found) throw new Error('Thread not found');
    return found;
  };
  const patch = (id: string, values: Partial<ThreadSummary>) => {
    const found = entry(id);
    found.summary = { ...found.summary, ...values };
    changed();
  };

  const logo = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 80;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 240, 80);
    gradient.addColorStop(0, '#6d4aff');
    gradient.addColorStop(1, '#e2499b');
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(0, 0, 240, 80, 16);
    context.fill();
    context.fillStyle = '#fff';
    context.font = 'bold 30px Segoe UI';
    context.fillText('Northwind', 20, 50);
    return canvas.toDataURL('image/png');
  };

  const aiStatus: AiStatus = { available: true, path: 'C:\\Users\\you\\.local\\bin\\claude.exe' };

  return {
    snapshot: async () => snapshot(),
    signIn: async (_kind) => {
      errorInfo = undefined;
      busy = true;
      changed();
      await delay(1200);
      busy = false;
      signedIn = true;
      changed();
    },
    signInWithCode: async (_kind) => undefined,
    cancelSignIn: async () => {
      errorInfo = undefined;
      busy = false;
      changed();
    },
    signOut: async () => {
      signedIn = false;
      changed();
    },
    refresh: async () => changed(),
    thread: async (id) => {
      await delay(150);
      return structuredClone(entry(id).detail);
    },
    markRead: async (id) => {
      const found = entry(id);
      found.detail.messages.forEach((m) => (m.isRead = true));
      patch(id, { unreadCount: 0, tags: found.summary.tags.filter((t) => t !== 'important') });
    },
    markUnread: async (id) => patch(id, { unreadCount: 1 }),
    setPinned: async (id, pinned) => patch(id, { pinned }),
    setMuted: async (id, muted) => patch(id, { muted }),
    setArchived: async (id, archived) => patch(id, { archived }),
    attachments: async (messageId) =>
      messageId === 'm1'
        ? [{ id: 'a1', name: 'Release-checklist.xlsx', size: 48_211, contentType: 'application/vnd.ms-excel', isInline: false }]
        : [{ id: 'a2', name: 'Renewal proposal 2027.pdf', size: 1_284_112, contentType: 'application/pdf', isInline: false }],
    inlineImages: async () => ({}),
    openAttachment: async () => undefined,
    saveAttachment: async () => undefined,
    sendReply: async (request) => {
      await delay(900);
      const found = entry(request.threadId);
      const others = found.detail.participants;
      const message = msg(request.threadId, ME, request.mode === 'all' ? others.slice(0, 3) : others.slice(0, 1), [], 0, `<p>${request.text.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`);
      found.detail.messages.push(message);
      found.summary = { ...found.summary, lastActivity: message.sentAt, lastSender: ME, lastFromMe: true, preview: message.preview, messageCount: found.summary.messageCount + 1 };
      changed();
      setTimeout(() => emit({ type: 'thread-updated', threadId: request.threadId }), 400);
      return { ok: true, threadId: request.threadId };
    },
    sendNew: async (request) => {
      await delay(900);
      const id = `t${Date.now()}`;
      const message = msg(id, ME, request.to, request.cc, 0, `<p>${request.text.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`);
      store.set(id, {
        detail: { id, subject: request.subject, messages: [message], participants: [...request.to, ...request.cc] },
        summary: {
          id,
          subject: request.subject,
          lastActivity: message.sentAt,
          lastSender: ME,
          lastFromMe: true,
          preview: message.preview,
          unreadCount: 0,
          messageCount: 1,
          participants: [...request.to, ...request.cc],
          tags: [],
          box: 'focused',
          pinned: false,
          muted: false,
          archived: false
        }
      });
      changed();
      return { ok: true, threadId: id };
    },
    searchPeople: async (query) => {
      const term = query.toLowerCase();
      return Object.values(P)
        .filter((p) => p.name.toLowerCase().includes(term) || p.email.includes(term))
        .map((p) => ({ ...p, source: 'people' as const }));
    },
    photo: async () => null,
    pickFiles: async () => [{ path: 'C:\\Users\\you\\Documents\\rollback.sql', name: 'rollback.sql', size: 4_812 }],
    describeFiles: async (paths) => paths.map((path) => ({ path, name: path.split(/[\\/]/).pop() ?? path, size: 1000 })),
    pathForFile: (file) => file.name,
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener');
    },
    saveSettings: async (values) => {
      settings = { ...settings, ...values };
      changed();
      return settings;
    },
    ai: async (request) => {
      await delay(1400);
      if (request.task === 'polish') {
        return {
          ok: true,
          text: `Hi Ravi,\n\nSure, I'll send you the SQL and the rollback script before 6 PM today.\n\nThanks,\nAlex`
        };
      }
      return {
        ok: true,
        text:
          "**TL;DR:** Thursday's release is on. Ravi needs your SQL + rollback script **today before 6 PM** so he can run it at 22:00.\n\n**What's going on**\n- Maya shared the release plan and wants everyone to confirm by Wed 3 PM.\n- Ben flagged that the Analytics migration is slow (9 min) and should be run by hand.\n- You said you'd run it manually; Maya pulled in Ravi (DB) and Nora (QA).\n\n**What they need from you**\n- Send Ravi the exact SQL **before 6 PM today**.\n- Include a rollback script.\n\n**Vibe:** productive, slightly rushed 🏃"
      };
    },
    aiStatus: async () => aiStatus,
    setGroupSilent: async (id, silent) => {
      groupSilent[id] = silent;
      for (const entry of store.values()) if (entry.summary.groupId === id) entry.summary.silenced = silent ? `The "${groupNames[id]}" group is silent` : undefined;
      changed();
    },
    moveToGroup: async (threadId, id) => {
      patch(threadId, { groupId: id ?? undefined, groupName: id ? groupNames[id] : undefined, silenced: id && groupSilent[id] ? `The "${groupNames[id]}" group is silent` : undefined });
    },
    createGroup: async (name) => {
      const id = `g${Date.now()}`;
      groupNames[id] = name;
      groupSilent[id] = true;
      changed();
      return id;
    },
    outlookSignatures: async () => [
      { name: 'Northwind (alex@example.com)', modified: ago(60 * 24 * 8) },
      { name: 'Me (alex@example.com)', modified: ago(60 * 24 * 160) }
    ],
    importOutlookSignature: async () =>
      `<table cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:12px"><img src="${logo()}" width="120" height="40" alt="Northwind" style="display:block;border:0"></td><td style="border-left:2px solid #6d4aff;padding-left:12px;font-family:Segoe UI;font-size:10pt;color:#444"><b>Alex Morgan</b><br>Software Engineer<br><a href="mailto:alex@example.com">alex@example.com</a></td></tr></table>`,
    pickImage: async () => ({ dataUrl: logo(), width: 240, height: 80, bytes: 4_210 }),
    setUnreadBadge: (count) => {
      document.title = count > 0 ? `(${count}) Mail Chat` : 'Mail Chat';
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
