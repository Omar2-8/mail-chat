import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, OutgoingAttachment, Person, ReplyMode, ThreadDetail, ThreadSummary } from '../../../shared/types';
import { api } from '../api';
import { Avatar, GroupAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Overlay';
import { clockTime, dayLabel, firstName, joinNames, plural, sameDay } from '../lib/format';
import { withHistory } from '../lib/history';
import { markdownToHtml } from '../lib/html';
import { key, membershipChange, myAudience } from '../lib/people';
import { Composer, type ComposerSend } from './Composer';
import { MessageBubble } from './MessageBubble';
import { threadMenu, type ThreadActions } from './Sidebar';

interface Pending {
  localId: number;
  text: string;
  files: OutgoingAttachment[];
  at: number;
  status: 'sending' | 'sent' | 'failed';
  error?: string;
  send: ComposerSend;
}

interface Summary {
  title: string;
  state: 'loading' | 'done' | 'error';
  text?: string;
}

interface ThreadViewProps {
  summary?: ThreadSummary;
  threadId: string;
  version: number;
  me: Set<string>;
  mePerson: Person;
  defaultMode: ReplyMode;
  aiEnabled: boolean;
  actions: ThreadActions;
  onToast: (text: string, tone?: 'info' | 'error') => void;
}

let localIds = 0;

export function ThreadView({ summary, threadId, version, me, mePerson, defaultMode, aiEnabled, actions, onToast }: ThreadViewProps) {
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessage | undefined>();
  const [ai, setAi] = useState<Summary | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<{ nonce: number; files: OutgoingAttachment[] }>({ nonce: 0, files: [] });
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const stickRef = useRef(true);
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(
    async (fresh: boolean) => {
      try {
        const result = await api.thread(threadId);
        setDetail((current) => (fresh || current?.id !== result.id || current.messages.length !== result.messages.length || changed(current, result) ? result : current));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [threadId]
  );

  useEffect(() => {
    setDetail(null);
    setError(null);
    setPending([]);
    setReplyTo(undefined);
    setAi(null);
    setShowMembers(false);
    stickRef.current = true;
    loadedFor.current = null;
    void load(true);
  }, [threadId, load]);

  useEffect(() => {
    if (version > 0) void load(false);
  }, [version, load]);

  useEffect(() => {
    if (!detail) return;
    setPending((list) => {
      const mine = detail.messages.filter((message) => message.fromMe).map((message) => Date.parse(message.sentAt));
      return list.filter((item) => item.status !== 'sent' || !mine.some((time) => time >= item.at - 90_000));
    });
  }, [detail]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !detail) return;
    if (loadedFor.current !== detail.id) {
      loadedFor.current = detail.id;
      const firstUnread = detail.messages.findIndex((message) => !message.isRead && !message.fromMe);
      const node = firstUnread > 0 ? scroller.querySelector<HTMLElement>(`[data-id="${CSS.escape(detail.messages[firstUnread].id)}"]`) : null;
      if (node) scroller.scrollTop = node.offsetTop - 80;
      else scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    if (stickRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [detail, pending]);

  const onScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const bottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    stickRef.current = bottom;
    setAtBottom(bottom);
  };

  const runSend = useCallback(
    async (item: Pending) => {
      const result = await api.sendReply({
        threadId,
        text: item.send.text,
        mode: item.send.mode,
        attachments: item.send.attachments,
        replyToId: item.send.replyToId
      });
      setPending((list) =>
        list.map((entry) => (entry.localId === item.localId ? { ...entry, status: result.ok ? 'sent' : 'failed', error: result.error } : entry))
      );
      if (!result.ok) onToast(result.error ?? 'Send failed', 'error');
      else setTimeout(() => setPending((list) => list.filter((entry) => entry.localId !== item.localId)), 45_000);
    },
    [threadId, onToast]
  );

  const send = useCallback(
    (data: ComposerSend) => {
      const item: Pending = { localId: ++localIds, text: data.text, files: data.attachments, at: Date.now(), status: 'sending', send: data };
      stickRef.current = true;
      setPending((list) => [...list, item]);
      void runSend(item);
    },
    [runSend]
  );

  const retry = (item: Pending) => {
    setPending((list) => list.map((entry) => (entry.localId === item.localId ? { ...entry, status: 'sending', error: undefined } : entry)));
    void runSend(item);
  };

  const explain = useCallback(
    async (task: 'tldr' | 'explain', message?: ChatMessage) => {
      const title = task === 'tldr' ? 'TL;DR of this chat' : `What ${message?.fromMe ? 'your' : `${firstName(message!.from)}'s`} email says`;
      setAi({ title, state: 'loading' });
      const result = await api.ai({ task, threadId, messageId: message?.id }).catch((e: Error) => ({ ok: false, error: e.message, text: undefined }));
      setAi((current) =>
        current?.title === title ? (result.ok ? { title, state: 'done', text: result.text } : { title, state: 'error', text: result.error }) : current
      );
    },
    [threadId]
  );

  const onExplain = useCallback((message: ChatMessage) => void explain('explain', message), [explain]);
  const onReply = useCallback((message: ChatMessage) => setReplyTo(message), []);

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => {
        try {
          return api.pathForFile(file);
        } catch {
          return '';
        }
      })
      .filter(Boolean);
    if (paths.length === 0) return;
    const files = await api.describeFiles(paths);
    setDropped({ nonce: Date.now(), files });
  };

  const participants = detail?.participants ?? summary?.participants ?? [];
  const subject = detail?.subject ?? summary?.subject ?? '';
  const faces = participants.slice(0, 2);

  const merged = useMemo(() => (detail ? withHistory(detail, me, mePerson.name) : { messages: [], added: 0 }), [detail, me, mePerson.name]);

  const rows = useMemo(() => {
    const list = merged.messages;
    const changeBetween = (a: ChatMessage | undefined, b: ChatMessage) => (a && !a.historical && !b.historical ? membershipChange(a, b, me) : undefined);
    return list.map((message, index) => {
      const previous = list[index - 1];
      const next = list[index + 1];
      const newDay = !previous || !sameDay(previous.sentAt, message.sentAt);
      const change = changeBetween(previous, message);
      const grouped = (other: ChatMessage | undefined) =>
        Boolean(other) && key(other!.from) === key(message.from) && Math.abs(Date.parse(other!.sentAt) - Date.parse(message.sentAt)) < 15 * 60_000 && sameDay(other!.sentAt, message.sentAt);
      return {
        message,
        newDay,
        change,
        first: newDay || Boolean(change) || !grouped(previous),
        last: !next || !grouped(next) || !sameDay(next.sentAt, message.sentAt) || Boolean(next && changeBetween(message, next)),
        audience: message.historical ? ('none' as const) : myAudience(message, me, participants.length + 1)
      };
    });
  }, [merged, me, participants.length]);

  return (
    <section
      className="thread"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => void onDrop(event)}
    >
      <header className="thread-head">
        <GroupAvatar people={faces.length ? faces : [{ name: subject, email: '' }]} size={42} />
        <div className="th-text">
          <h2 dir="auto" title={subject}>
            {subject}
          </h2>
          <button className="th-sub" onClick={() => setShowMembers((value) => !value)}>
            You, {joinNames(participants, 4)} · {plural(participants.length + 1, 'person', 'people')}
            {detail ? ` · ${plural(detail.messages.length, 'email')}` : ''}
            {merged.added > 0 ? ` + ${merged.added} earlier` : ''}
          </button>
        </div>
        {aiEnabled && (
          <button className="btn ai-btn" onClick={() => void explain('tldr')} disabled={!detail || ai?.state === 'loading'} title="Explain this whole thread in plain words">
            <Icon name="sparkles" size={16} /> TL;DR
          </button>
        )}
        <button className={`icon-btn${showMembers ? ' on' : ''}`} onClick={() => setShowMembers((value) => !value)} title="People in this chat">
          <Icon name="users" />
        </button>
        {summary && (
          <button ref={menuRef} className="icon-btn" onClick={() => setMenu(menuRef.current?.getBoundingClientRect() ?? null)} title="More">
            <Icon name="more" />
          </button>
        )}
      </header>

      <div className="thread-body">
        <div className="thread-main">
          {ai && (
            <div className={`ai-card ${ai.state}`}>
              <div className="ai-head">
                <Icon name="sparkles" size={16} />
                <span>{ai.title}</span>
                <span className="grow" />
                <button className="icon-btn tiny" onClick={() => setAi(null)} aria-label="Close summary">
                  <Icon name="x" size={14} />
                </button>
              </div>
              {ai.state === 'loading' && (
                <div className="ai-loading">
                  <span className="shimmer" />
                  <span className="shimmer short" />
                  <span className="shimmer" />
                </div>
              )}
              {ai.state === 'done' && ai.text && <div className="ai-text" dir="auto" dangerouslySetInnerHTML={{ __html: markdownToHtml(ai.text) }} />}
              {ai.state === 'error' && <div className="ai-error">{ai.text}</div>}
            </div>
          )}
          <div className="messages-wrap">
          <div className="messages" ref={scrollRef} onScroll={onScroll}>
            {!detail && !error && (
              <div className="center-note">
                <div className="spinner" />
              </div>
            )}
            {error && (
              <div className="center-note error">
                <Icon name="alert" /> {error}
                <button className="btn small" onClick={() => void load(true)}>
                  Try again
                </button>
              </div>
            )}
            {detail && (
              <div className="thread-start">
                <GroupAvatar people={faces.length ? faces : [{ name: subject, email: '' }]} size={56} />
                <h3 dir="auto">{subject}</h3>
                <p>
                  {merged.messages[0] ? (
                    <>
                      {merged.messages[0].fromMe ? 'You' : merged.messages[0].from.name} started this chat · {dayLabel(merged.messages[0].sentAt)}
                    </>
                  ) : (
                    'Empty thread'
                  )}
                </p>
              </div>
            )}
            {rows.map((row) => (
              <Fragment key={row.message.id}>
                {row.newDay && (
                  <div className="day-sep">
                    <span>{dayLabel(row.message.sentAt)}</span>
                  </div>
                )}
                {row.change && <ChangeLine change={row.change} />}
                <MessageBubble
                  message={row.message}
                  first={row.first}
                  last={row.last}
                  audience={row.audience}
                  aiEnabled={aiEnabled}
                  onReply={onReply}
                  onExplain={onExplain}
                  onToast={onToast}
                />
              </Fragment>
            ))}
            {pending.map((item) => (
              <div key={item.localId} className={`msg mine first last pending ${item.status}`}>
                <div className="msg-col">
                  <div className="bubble-wrap">
                    <div className="bubble">
                      <div className="bubble-body plain" dir="auto">
                        {item.text}
                      </div>
                      {item.files.length > 0 && <div className="pending-files">📎 {item.files.map((file) => file.name).join(', ')}</div>}
                      <div className="bubble-foot">
                        <span className="time">
                          {item.status === 'sending' && 'Sending…'}
                          {item.status === 'sent' && (
                            <>
                              <Icon name="check" size={13} /> Sent {clockTime(new Date(item.at).toISOString())}
                            </>
                          )}
                          {item.status === 'failed' && 'Not sent'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {item.status === 'failed' && (
                    <div className="failed-line">
                      <Icon name="alert" size={14} /> {item.error}
                      <button className="link" onClick={() => retry(item)}>
                        Retry
                      </button>
                      <button className="link" onClick={() => setPending((list) => list.filter((entry) => entry.localId !== item.localId))}>
                        Discard
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {!atBottom && (
            <button
              className="jump"
              onClick={() => {
                const scroller = scrollRef.current;
                if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
              }}
              title="Jump to latest"
            >
              <Icon name="arrowDown" />
            </button>
          )}
          </div>
          {detail && (
            <Composer
              detail={detail}
              me={me}
              defaultMode={defaultMode}
              aiEnabled={aiEnabled}
              replyTo={replyTo}
              dropped={dropped}
              onClearReplyTo={() => setReplyTo(undefined)}
              onSend={send}
              onToast={onToast}
            />
          )}
          {dragging && (
            <div className="drop-zone">
              <Icon name="clip" size={32} />
              <p>Drop to attach</p>
            </div>
          )}
        </div>
        {showMembers && <Members participants={participants} mePerson={mePerson} detail={detail} onClose={() => setShowMembers(false)} />}
      </div>
      {menu && summary && <Menu anchor={menu} onClose={() => setMenu(null)} items={threadMenu(summary, actions)} />}
    </section>
  );
}

function changed(a: ThreadDetail, b: ThreadDetail): boolean {
  return a.messages.some((message, index) => message.id !== b.messages[index]?.id || message.isRead !== b.messages[index]?.isRead);
}

function ChangeLine({ change }: { change: NonNullable<ReturnType<typeof membershipChange>> }) {
  const actor = change.actorIsMe ? 'You' : firstName(change.actor);
  return (
    <div className="change-line">
      {change.added.length > 0 && (
        <span>
          <Icon name="userPlus" size={13} /> {actor} added {joinNames(change.added, 3)}
        </span>
      )}
      {change.dropped.length > 0 && (
        <span title={change.dropped.map((p) => p.name).join(', ')}>
          <Icon name="userMinus" size={13} /> {actor} left out {joinNames(change.dropped, 3)}
        </span>
      )}
    </div>
  );
}

function Members({ participants, mePerson, detail, onClose }: { participants: Person[]; mePerson: Person; detail: ThreadDetail | null; onClose: () => void }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const message of detail?.messages ?? []) map.set(key(message.from), (map.get(key(message.from)) ?? 0) + 1);
    return map;
  }, [detail]);
  const sorted = [...participants].sort((a, b) => (counts.get(key(b)) ?? 0) - (counts.get(key(a)) ?? 0));
  return (
    <aside className="members">
      <header>
        <h3>{plural(participants.length + 1, 'person', 'people')}</h3>
        <button className="icon-btn tiny" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} />
        </button>
      </header>
      <div className="member">
        <Avatar person={mePerson} size={32} />
        <div>
          <b>You</b>
          <span className="muted">{mePerson.email}</span>
        </div>
      </div>
      {sorted.map((person) => (
        <div key={person.email} className="member" title="Click to copy email" onClick={() => void navigator.clipboard.writeText(person.email)}>
          <Avatar person={person} size={32} />
          <div>
            <b dir="auto">{person.name}</b>
            <span className="muted">{person.email}</span>
          </div>
          {counts.get(key(person)) ? <span className="msg-count">{counts.get(key(person))}</span> : <span className="lurker" title="Hasn't written in this thread">👀</span>}
        </div>
      ))}
    </aside>
  );
}
