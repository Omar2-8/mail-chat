import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSnapshot, ThreadSummary } from '../../shared/types';
import { api, isMock } from './api';
import { Icon } from './components/Icon';
import { Toasts } from './components/Overlay';
import { NewChat } from './views/NewChat';
import { SettingsProvider } from './lib/settings';
import { MoveToGroup } from './views/MoveToGroup';
import { SettingsDialog, type SettingsTab } from './views/SettingsDialog';
import { SignIn } from './views/SignIn';
import { Sidebar, visibleThreads, type Filter, type ThreadActions } from './views/Sidebar';
import { ThreadView } from './views/ThreadView';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

let toastIds = 0;

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [filter, setFilter] = useState<Filter>('chats');
  const [query, setQuery] = useState('');
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [modal, setModal] = useState<'new' | 'settings' | null>(null);
  const [groupId, setGroupId] = useState<string | undefined>();
  const [moving, setMoving] = useState<ThreadSummary | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const toast = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    const id = ++toastIds;
    setToasts((list) => [...list.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), tone === 'error' ? 7000 : 2600);
  }, []);

  useEffect(() => {
    void api.snapshot().then(setSnapshot);
    return api.onEvent((event) => {
      if (event.type === 'snapshot') setSnapshot(event.snapshot);
      if (event.type === 'thread-updated') setVersions((current) => ({ ...current, [event.threadId]: (current[event.threadId] ?? 0) + 1 }));
      if (event.type === 'open-thread') {
        setQuery('');
        setSelectedId(event.threadId);
      }
    });
  }, []);

  const threads = snapshot?.threads ?? [];
  const selected = useMemo(() => threads.find((thread) => thread.id === selectedId), [threads, selectedId]);
  const meSet = useMemo(() => {
    const set = new Set<string>();
    if (snapshot?.me?.email) set.add(snapshot.me.email.toLowerCase());
    if (snapshot?.auth.account?.email) set.add(snapshot.auth.account.email.toLowerCase());
    return set;
  }, [snapshot?.me?.email, snapshot?.auth.account?.email]);

  const totalUnread = useMemo(
    () => threads.filter((thread) => !thread.muted && !thread.silenced && !thread.archived && thread.box === 'focused').reduce((sum, thread) => sum + (thread.unreadCount > 0 ? 1 : 0), 0),
    [threads]
  );

  useEffect(() => {
    api.setUnreadBadge(totalUnread);
  }, [totalUnread]);

  const selectedThreadId = selected?.id;
  const selectedUnread = (selected?.unreadCount ?? 0) > 0;

  useEffect(() => {
    if (!selectedThreadId || !selectedUnread) return;
    const timer = setTimeout(() => {
      if (document.hasFocus() || isMock) void api.markRead(selectedThreadId).catch(() => undefined);
    }, 900);
    const onFocus = () => void api.markRead(selectedThreadId).catch(() => undefined);
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [selectedThreadId, selectedUnread]);

  const actions: ThreadActions = useMemo(
    () => ({
      pin: (thread) => void api.setPinned(thread.id, !thread.pinned),
      mute: (thread) => {
        void api.setMuted(thread.id, !thread.muted);
        toast(thread.muted ? 'Notifications back on' : 'Muted. No pings from this one. 🤫');
      },
      toggleRead: (thread) => void (thread.unreadCount > 0 ? api.markRead(thread.id) : api.markUnread(thread.id)),
      archive: (thread) => {
        void api.setArchived(thread.id, !thread.archived).then(
          () => {
            toast(thread.archived ? 'Back in your chats' : 'Archived. It comes back if someone replies.');
            if (!thread.archived && thread.id === selectedId) setSelectedId(undefined);
          },
          (error: Error) => toast(error.message, 'error')
        );
      },
      openInOutlook: (thread) => thread.webLink && void api.openExternal(thread.webLink),
      moveToGroup: (thread) => setMoving(thread),
      removeFromGroup: (thread) => {
        void api
          .moveToGroup(thread.id, null)
          .then(() => toast('Back in your main chats'))
          .catch((error: Error) => toast(error.message, 'error'));
      }
    }),
    [toast, selectedId]
  );

  const move = useCallback(
    (step: number) => {
      const list = visibleThreads(threads, filter, query, snapshot?.groups ?? [], groupId);
      if (list.length === 0) return;
      const index = list.findIndex((thread) => thread.id === selectedId);
      const next = list[Math.max(0, Math.min(list.length - 1, index + step))];
      if (next) setSelectedId(next.id);
    },
    [threads, filter, query, selectedId, snapshot?.groups, groupId]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setModal('new');
      } else if (ctrl && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'f')) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (ctrl && event.key === ',') {
        event.preventDefault();
        setSettingsTab('general');
        setModal('settings');
      } else if (event.key === 'F5') {
        event.preventDefault();
        void api.refresh();
      } else if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        move(event.key === 'ArrowDown' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move]);

  useEffect(() => {
    const theme = snapshot?.settings.theme ?? 'system';
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [snapshot?.settings.theme]);

  if (!snapshot) return <div className="boot"><div className="spinner big" /></div>;
  if (!snapshot.auth.signedIn) return <SignIn auth={snapshot.auth} />;

  const signOut = () => {
    setModal(null);
    setSelectedId(undefined);
    void api.signOut();
  };

  const me = snapshot.me ?? snapshot.auth.account ?? { name: 'You', email: '' };
  const openSettings = (tab: SettingsTab = 'general') => {
    setSettingsTab(tab);
    setModal('settings');
  };

  return (
    <SettingsProvider settings={snapshot.settings} me={me}>
      <div className="app">
        <Sidebar
          me={snapshot.me}
          threads={threads}
          groups={snapshot.groups}
          groupId={groupId}
          onOpenGroup={(id) => {
            setGroupId(id);
            setQuery('');
          }}
          onGroupSilent={(group, silent) => {
            void api.setGroupSilent(group.id, silent);
            toast(silent ? `"${group.name}" is silent now` : `You'll get notifications from "${group.name}"`);
          }}
          sync={snapshot.sync}
          selectedId={selectedId}
          filter={filter}
          query={query}
          searchRef={searchRef}
          onFilter={setFilter}
          onQuery={setQuery}
          onSelect={setSelectedId}
          onNewChat={() => setModal('new')}
          onSettings={openSettings}
          onSignOut={signOut}
          onRefresh={() => void api.refresh()}
          actions={actions}
        />
        {selectedId ? (
          <ThreadView
            key={selectedId}
            summary={selected}
            threadId={selectedId}
            version={versions[selectedId] ?? 0}
            me={meSet}
            mePerson={me}
            defaultMode={snapshot.settings.defaultReplyMode}
            aiEnabled={snapshot.settings.aiEnabled}
            actions={actions}
            onToast={toast}
          />
        ) : (
          <Welcome threads={threads} onPick={setSelectedId} onNew={() => setModal('new')} />
        )}
        {moving && <MoveToGroup thread={moving} groups={snapshot.groups} onClose={() => setMoving(null)} onDone={toast} />}
        {modal === 'new' && (
          <NewChat
            onClose={() => setModal(null)}
            onToast={toast}
            onSent={(threadId) => {
              setModal(null);
              if (threadId) setSelectedId(threadId);
            }}
          />
        )}
        {modal === 'settings' && (
          <SettingsDialog settings={snapshot.settings} me={snapshot.me} initialTab={settingsTab} onClose={() => setModal(null)} onSignOut={signOut} />
        )}
        <Toasts toasts={toasts} dismiss={(id) => setToasts((list) => list.filter((item) => item.id !== id))} />
      </div>
    </SettingsProvider>
  );
}

function Welcome({ threads, onPick, onNew }: { threads: ThreadSummary[]; onPick: (id: string) => void; onNew: () => void }) {
  const unread = threads.filter((thread) => thread.unreadCount > 0 && !thread.archived && !thread.silenced && !thread.muted && thread.box === 'focused');
  const direct = unread.filter((thread) => !thread.tags.includes('fyi'));
  return (
    <section className="welcome">
      <div className="welcome-inner">
        <div className="welcome-emoji">💬</div>
        <h2>{unread.length === 0 ? "You're all caught up." : `${unread.length} chat${unread.length === 1 ? '' : 's'} waiting`}</h2>
        <p className="muted">
          {unread.length === 0
            ? 'Pick a chat on the left, or start a new one.'
            : `${direct.length} need${direct.length === 1 ? 's' : ''} you directly, ${unread.length - direct.length} ${unread.length - direct.length === 1 ? 'is' : 'are'} just FYI.`}
        </p>
        {direct.length > 0 && (
          <div className="welcome-list">
            {direct.slice(0, 5).map((thread) => (
              <button key={thread.id} className="welcome-item" onClick={() => onPick(thread.id)}>
                <span className="badge">{thread.unreadCount}</span>
                <span dir="auto">{thread.subject}</span>
                <span className="muted">{thread.lastSender.name}</span>
              </button>
            ))}
          </div>
        )}
        <button className="btn primary" onClick={onNew}>
          <Icon name="compose" size={16} /> New chat
        </button>
        <p className="shortcuts">
          <kbd>Ctrl</kbd>+<kbd>N</kbd> new chat · <kbd>Ctrl</kbd>+<kbd>K</kbd> search · <kbd>Alt</kbd>+<kbd>↑↓</kbd> switch chats
        </p>
      </div>
    </section>
  );
}
