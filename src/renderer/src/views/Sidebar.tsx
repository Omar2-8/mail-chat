import { MOD } from '../platform';
import { memo, useMemo, useRef, useState } from 'react';
import type { GroupSummary, Person, SyncState, ThreadSummary } from '../../../shared/types';
import { Avatar, GroupAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Menu, type MenuItem } from '../components/Overlay';
import { firstName, hueOf, listTime, relativeAgo } from '../lib/format';
import { dndActive, dndLabel, pauseUntil, useSettings } from '../lib/settings';
import type { SettingsTab } from './SettingsDialog';

export type Filter = 'chats' | 'unread' | 'fyi' | 'other' | 'archived';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'chats', label: 'Chats' },
  { id: 'unread', label: 'Unread' },
  { id: 'fyi', label: 'FYI' },
  { id: 'other', label: 'Other' },
  { id: 'archived', label: 'Archived' }
];

export interface ThreadActions {
  pin: (thread: ThreadSummary) => void;
  mute: (thread: ThreadSummary) => void;
  toggleRead: (thread: ThreadSummary) => void;
  archive: (thread: ThreadSummary) => void;
  openInOutlook: (thread: ThreadSummary) => void;
  moveToGroup: (thread: ThreadSummary) => void;
  removeFromGroup: (thread: ThreadSummary) => void;
}

export function threadMenu(thread: ThreadSummary, actions: ThreadActions): MenuItem[] {
  return [
    { label: thread.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', onSelect: () => actions.pin(thread) },
    { label: thread.muted ? 'Unmute' : 'Mute notifications', icon: thread.muted ? 'bell' : 'bellOff', onSelect: () => actions.mute(thread) },
    { label: thread.unreadCount > 0 ? 'Mark as read' : 'Mark as unread', icon: 'mail', onSelect: () => actions.toggleRead(thread) },
    { label: thread.archived ? 'Unarchive' : 'Archive', icon: 'archive', onSelect: () => actions.archive(thread) },
    { label: thread.groupId ? 'Move to another group…' : 'Move to a group…', icon: 'inbox', onSelect: () => actions.moveToGroup(thread) },
    ...(thread.groupId ? [{ label: 'Back to main chats', icon: 'undo' as const, onSelect: () => actions.removeFromGroup(thread) }] : []),
    ...(thread.webLink ? [{ label: 'Open in Outlook', icon: 'external' as const, onSelect: () => actions.openInOutlook(thread) }] : [])
  ];
}

function matches(thread: ThreadSummary, filter: Filter, silentGroups: Set<string>): boolean {
  if (filter === 'archived') return thread.archived;
  if (thread.archived) return false;
  if (filter === 'unread') return thread.unreadCount > 0 && (thread.groupId ? !silentGroups.has(thread.groupId) : thread.box === 'focused');
  if (thread.groupId) return false;
  if (filter === 'other') return thread.box === 'other';
  if (thread.box === 'other') return false;
  if (filter === 'fyi') return thread.tags.includes('fyi');
  return true;
}

function searchHit(thread: ThreadSummary, terms: string[]): boolean {
  const haystack = [thread.subject, thread.preview, thread.lastSender.name, ...thread.participants.flatMap((p) => [p.name, p.email])]
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function visibleThreads(threads: ThreadSummary[], filter: Filter, query: string, groups: GroupSummary[] = [], groupId?: string): ThreadSummary[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length > 0) return threads.filter((thread) => searchHit(thread, terms));
  if (groupId) return threads.filter((thread) => thread.groupId === groupId && !thread.archived);
  const silent = new Set(groups.filter((group) => group.silent).map((group) => group.id));
  return threads.filter((thread) => matches(thread, filter, silent));
}

interface SidebarProps {
  me?: Person;
  threads: ThreadSummary[];
  groups: GroupSummary[];
  groupId?: string;
  onOpenGroup: (groupId?: string) => void;
  onGroupSilent: (group: GroupSummary, silent: boolean) => void;
  sync: SyncState;
  selectedId?: string;
  filter: Filter;
  query: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onFilter: (filter: Filter) => void;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onSettings: (tab?: SettingsTab) => void;
  onSignOut: () => void;
  onRefresh: () => void;
  actions: ThreadActions;
}

export function Sidebar(props: SidebarProps) {
  const { threads, filter, query, groups, groupId } = props;
  const [groupsOpen, setGroupsOpen] = useState(true);
  const [groupMenu, setGroupMenu] = useState<{ group: GroupSummary; x: number; y: number } | null>(null);
  const openGroup = groups.find((group) => group.id === groupId);
  const { settings, update } = useSettings();
  const [meMenu, setMeMenu] = useState<DOMRect | null>(null);
  const [bellMenu, setBellMenu] = useState<DOMRect | null>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const paused = dndActive(settings) || !settings.notifications;
  const [context, setContext] = useState<{ thread: ThreadSummary; x: number; y: number } | null>(null);
  const meRef = useRef<HTMLButtonElement>(null);
  const list = useMemo(() => visibleThreads(threads, filter, query, groups, openGroup?.id), [threads, filter, query, groups, openGroup?.id]);
  const counts = useMemo(() => {
    const silent = new Set(groups.filter((group) => group.silent).map((group) => group.id));
    const result: Partial<Record<Filter, number>> = {};
    for (const f of FILTERS) {
      if (f.id === 'chats' || f.id === 'archived') continue;
      result[f.id] = threads.filter((t) => matches(t, f.id, silent) && t.unreadCount > 0).length;
    }
    return result;
  }, [threads, groups]);
  const showGroups = !query && !openGroup && filter === 'chats' && groups.length > 0;

  return (
    <aside className="sidebar">
      <header className="side-head">
        <button ref={meRef} className="me-btn" onClick={() => setMeMenu(meRef.current?.getBoundingClientRect() ?? null)} title="You">
          {props.me ? <Avatar person={props.me} size={32} /> : <span className="avatar" style={{ width: 32, height: 32 }} />}
        </button>
        <h1>Chats</h1>
        <div className="grow" />
        <button
          ref={bellRef}
          className={`icon-btn${paused ? ' on' : ''}`}
          onClick={() => setBellMenu(bellRef.current?.getBoundingClientRect() ?? null)}
          title={paused ? (settings.notifications ? dndLabel(settings) : 'Notifications are off') : 'Notifications'}
        >
          <Icon name={paused ? 'bellOff' : 'bell'} />
        </button>
        <button className="icon-btn" onClick={props.onRefresh} title="Refresh (F5)">
          <Icon name="refresh" className={props.sync.phase === 'syncing' || props.sync.phase === 'loading' ? 'spin' : ''} />
        </button>
        <button className="icon-btn accent" onClick={props.onNewChat} title={`New chat (${MOD}+N)`}>
          <Icon name="compose" />
        </button>
      </header>
      <div className="search">
        <Icon name="search" size={16} />
        <input
          ref={props.searchRef}
          value={query}
          onChange={(event) => props.onQuery(event.target.value)}
          placeholder="Search chats, people…"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === 'Escape') props.onQuery('');
            if (event.key === 'Enter' && list[0]) props.onSelect(list[0].id);
          }}
        />
        {query && (
          <button className="icon-btn tiny" onClick={() => props.onQuery('')} aria-label="Clear search">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      {!query && openGroup && (
        <div className="group-head">
          <button className="icon-btn" onClick={() => props.onOpenGroup(undefined)} title="Back to chats">
            <Icon name="arrowLeft" />
          </button>
          <span className="folder-badge small" style={{ '--h': hueOf(openGroup.name) } as React.CSSProperties}>
            <Icon name="inbox" size={14} />
          </span>
          <b dir="auto">{openGroup.name}</b>
          <span className="muted small">{openGroup.threadCount}</span>
          <span className="grow" />
          <button
            className={`icon-btn${openGroup.silent ? ' on' : ''}`}
            onClick={() => props.onGroupSilent(openGroup, !openGroup.silent)}
            title={openGroup.silent ? 'Silent group. Click to get notifications' : 'Click to silence this group'}
          >
            <Icon name={openGroup.silent ? 'bellOff' : 'bell'} />
          </button>
        </div>
      )}
      {!query && !openGroup && (
        <nav className="chips">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip${filter === f.id ? ' on' : ''}`} onClick={() => props.onFilter(f.id)}>
              {f.label}
              {counts[f.id] ? <span className="chip-count">{counts[f.id]}</span> : null}
            </button>
          ))}
        </nav>
      )}
      <div className="thread-list" role="listbox" aria-label="Chats">
        {showGroups && (
          <div className="group-section">
            <button className="section-label" onClick={() => setGroupsOpen((open) => !open)}>
              <Icon name="chevronDown" size={14} className={groupsOpen ? '' : 'rot'} />
              Groups
              <span className="muted">{groups.length}</span>
            </button>
            {groupsOpen &&
              groups.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  onOpen={() => props.onOpenGroup(group.id)}
                  onContext={(x, y) => setGroupMenu({ group, x, y })}
                />
              ))}
            <div className="section-label static">Chats</div>
          </div>
        )}
        {list.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            selected={thread.id === props.selectedId}
            showGroup={!openGroup}
            onSelect={props.onSelect}
            onContext={(x, y) => setContext({ thread, x, y })}
          />
        ))}
        {list.length === 0 && <EmptyList filter={filter} query={query} loading={props.sync.phase === 'loading'} />}
      </div>
      <footer className="side-foot">
        {paused && (
          <div className="paused-line">
            <Icon name="bellOff" size={13} />
            <span>{settings.notifications ? dndLabel(settings) : 'Notifications are off'}</span>
            <button className="link" onClick={() => void update(settings.notifications ? { dndUntil: '' } : { notifications: true, dndUntil: '' })}>
              Resume
            </button>
          </div>
        )}
        <SyncLine sync={props.sync} />
      </footer>
      {bellMenu && (
        <Menu
          anchor={bellMenu}
          onClose={() => setBellMenu(null)}
          items={[
            ...(paused
              ? [{ label: 'Resume notifications', icon: 'bell' as const, onSelect: () => void update({ notifications: true, dndUntil: '' }) }]
              : [
                  { label: 'Pause for 1 hour', icon: 'bellOff' as const, onSelect: () => void update({ dndUntil: pauseUntil('1h') }) },
                  { label: 'Pause for 3 hours', icon: 'bellOff' as const, onSelect: () => void update({ dndUntil: pauseUntil('3h') }) },
                  { label: 'Pause until tomorrow 8 AM', icon: 'bellOff' as const, onSelect: () => void update({ dndUntil: pauseUntil('tomorrow') }) },
                  { label: 'Pause until I resume', icon: 'bellOff' as const, onSelect: () => void update({ dndUntil: pauseUntil('forever') }) }
                ]),
            { label: 'Notification rules…', icon: 'sliders' as const, onSelect: () => props.onSettings('notifications') }
          ]}
        />
      )}
      {meMenu && (
        <Menu
          anchor={meMenu}
          align="start"
          onClose={() => setMeMenu(null)}
          items={[
            { label: 'Settings', icon: 'sliders', onSelect: () => props.onSettings(), hint: `${MOD}+,` },
            { label: 'Signature', icon: 'compose', onSelect: () => props.onSettings('signature') },
            { label: 'Sign out', icon: 'logout', danger: true, onSelect: props.onSignOut }
          ]}
        />
      )}
      {context && <Menu anchor={{ x: context.x, y: context.y }} align="start" onClose={() => setContext(null)} items={threadMenu(context.thread, props.actions)} />}
      {groupMenu && (
        <Menu
          anchor={{ x: groupMenu.x, y: groupMenu.y }}
          align="start"
          onClose={() => setGroupMenu(null)}
          items={[
            { label: 'Open group', icon: 'inbox', onSelect: () => props.onOpenGroup(groupMenu.group.id) },
            {
              label: groupMenu.group.silent ? 'Turn notifications on' : 'Silence this group',
              icon: groupMenu.group.silent ? 'bell' : 'bellOff',
              onSelect: () => props.onGroupSilent(groupMenu.group, !groupMenu.group.silent)
            }
          ]}
        />
      )}
    </aside>
  );
}

function EmptyList({ filter, query, loading }: { filter: Filter; query: string; loading: boolean }) {
  if (loading)
    return (
      <div className="list-empty">
        <div className="spinner" />
        <p>Loading your chats…</p>
      </div>
    );
  const text = query
    ? `Nothing matches "${query}".`
    : filter === 'unread'
      ? 'All caught up. Touch grass. 🌱'
      : filter === 'fyi'
        ? "No CC'd threads right now."
        : filter === 'archived'
          ? 'Nothing archived.'
          : filter === 'other'
            ? 'No newsletters or bot mail. Nice.'
            : 'No chats yet.';
  return (
    <div className="list-empty">
      <p>{text}</p>
    </div>
  );
}

function SyncLine({ sync }: { sync: SyncState }) {
  const tone = sync.phase === 'error' ? 'bad' : sync.phase === 'offline' ? 'warn' : sync.phase === 'idle' ? 'ok' : 'busy';
  const text =
    sync.phase === 'loading'
      ? 'Loading mail…'
      : sync.phase === 'syncing'
        ? 'Syncing…'
        : sync.phase === 'offline'
          ? "Can't reach Microsoft. Retrying."
          : sync.phase === 'error'
            ? sync.error ?? 'Sync failed'
            : `Synced ${relativeAgo(sync.lastSyncAt)}`;
  return (
    <div className={`sync ${tone}`} title={sync.error ?? ''}>
      <span className="dot" />
      <span className="sync-text">{text}</span>
      <span className="muted">· last {sync.historyDays} days</span>
    </div>
  );
}

function GroupRow({ group, onOpen, onContext }: { group: GroupSummary; onOpen: () => void; onContext: (x: number, y: number) => void }) {
  const unread = group.unreadThreads > 0;
  return (
    <div
      role="option"
      aria-selected={false}
      tabIndex={0}
      className={`thread-row group-row${unread ? ' unread' : ''}${group.silent ? ' muted-row' : ''}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContext(event.clientX, event.clientY);
      }}
    >
      <span className="folder-badge" style={{ '--h': hueOf(group.name) } as React.CSSProperties}>
        <Icon name="inbox" size={20} />
      </span>
      <div className="tr-main">
        <div className="tr-top">
          <span className="tr-subject" dir="auto">
            {group.name}
          </span>
          <span className="tr-time">{group.lastActivity ? listTime(group.lastActivity) : ''}</span>
        </div>
        <div className="tr-bottom">
          <span className="tr-preview" dir="auto">
            {group.latestSubject ? (
              <>
                <b>{group.latestSender}:</b> {group.latestSubject}
              </>
            ) : (
              'No emails in this period'
            )}
          </span>
          <span className="tr-icons">
            {group.silent && (
              <span title="Silent group: no notifications">
                <Icon name="bellOff" size={13} />
              </span>
            )}
            {unread && <span className="badge">{group.unreadThreads}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

const ThreadRow = memo(function ThreadRow({
  thread,
  selected,
  showGroup,
  onSelect,
  onContext
}: {
  thread: ThreadSummary;
  selected: boolean;
  showGroup: boolean;
  onSelect: (id: string) => void;
  onContext: (x: number, y: number) => void;
}) {
  const unread = thread.unreadCount > 0;
  const faces = useMemo(() => {
    const lead = thread.lastFromMe ? thread.participants[0] : thread.lastSender;
    const rest = thread.participants.filter((p) => p.email.toLowerCase() !== lead?.email.toLowerCase());
    return [lead, ...rest].filter(Boolean).slice(0, 2) as Person[];
  }, [thread]);
  const who = thread.lastFromMe ? 'You' : firstName(thread.lastSender);
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={`thread-row${selected ? ' selected' : ''}${unread ? ' unread' : ''}${thread.muted || thread.silenced ? ' muted-row' : ''}`}
      onClick={() => onSelect(thread.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect(thread.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContext(event.clientX, event.clientY);
      }}
    >
      <GroupAvatar people={faces} size={46} />
      <div className="tr-main">
        <div className="tr-top">
          <span className="tr-subject" dir="auto">
            {thread.subject}
          </span>
          <span className="tr-time">{listTime(thread.lastActivity)}</span>
        </div>
        <div className="tr-bottom">
          {showGroup && thread.groupName && <span className="pill group">{thread.groupName}</span>}
          {thread.tags.includes('fyi') && <span className="pill fyi">FYI</span>}
          {thread.tags.includes('important') && <span className="pill hot">!</span>}
          <span className="tr-preview" dir="auto">
            <b>{who}:</b> {thread.preview || '(no text)'}
          </span>
          <span className="tr-icons">
            {thread.tags.includes('meeting') && <Icon name="calendar" size={13} />}
            {thread.tags.includes('attachment') && <Icon name="clip" size={13} />}
            {thread.tags.includes('external') && <Icon name="globe" size={13} />}
            {(thread.muted || thread.silenced) && (
              <span title={thread.muted ? 'You muted this chat' : `Silent: ${thread.silenced}`}>
                <Icon name="bellOff" size={13} />
              </span>
            )}
            {thread.pinned && <Icon name="pin" size={13} />}
            {unread && <span className="badge">{thread.unreadCount}</span>}
          </span>
        </div>
      </div>
    </div>
  );
});
