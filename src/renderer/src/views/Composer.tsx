import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, OutgoingAttachment, ReplyMode, ThreadDetail } from '../../../shared/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { fileSize, firstName, joinNames } from '../lib/format';
import { replyRecipients, replyTarget } from '../lib/people';

interface Draft {
  text: string;
  attachments: OutgoingAttachment[];
  mode?: ReplyMode;
}

const drafts = new Map<string, Draft>();

export interface ComposerSend {
  text: string;
  mode: ReplyMode;
  attachments: OutgoingAttachment[];
  replyToId?: string;
}

interface ComposerProps {
  detail: ThreadDetail;
  me: Set<string>;
  defaultMode: ReplyMode;
  aiEnabled: boolean;
  replyTo?: ChatMessage;
  dropped: { nonce: number; files: OutgoingAttachment[] };
  onClearReplyTo: () => void;
  onSend: (send: ComposerSend) => void;
  onToast: (text: string, tone?: 'info' | 'error') => void;
}

export function Composer({ detail, me, defaultMode, aiEnabled, replyTo, dropped, onClearReplyTo, onSend, onToast }: ComposerProps) {
  const threadId = detail.id;
  const [draft, setDraft] = useState<Draft>(() => drafts.get(threadId) ?? { text: '', attachments: [] });
  const [polishing, setPolishing] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(drafts.get(threadId) ?? { text: '', attachments: [] });
    setSuggestion(null);
    setPrevious(null);
    textRef.current?.focus();
  }, [threadId]);

  useEffect(() => {
    drafts.set(threadId, draft);
  }, [threadId, draft]);

  useEffect(() => {
    if (dropped.files.length === 0) return;
    setDraft((current) => ({ ...current, attachments: mergeFiles(current.attachments, dropped.files) }));
  }, [dropped]);

  useEffect(() => {
    if (replyTo) textRef.current?.focus();
  }, [replyTo]);

  useLayoutEffect(() => {
    const area = textRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 240)}px`;
  }, [draft.text, suggestion]);

  const mode: ReplyMode = replyTo ? (draft.mode ?? 'sender') : (draft.mode ?? defaultMode);
  const target = replyTarget(detail.messages, mode, replyTo?.id);
  const recipients = useMemo(() => replyRecipients(target, mode, me), [target, mode, me]);
  const allCount = useMemo(() => {
    const all = replyRecipients(replyTarget(detail.messages, 'all', replyTo?.id), 'all', me);
    return all.to.length + all.cc.length;
  }, [detail.messages, replyTo, me]);
  const senderName = target ? (target.fromMe ? firstName(target.to[0] ?? target.from) : firstName(target.from)) : '';
  const canSend = draft.text.trim().length > 0 && recipients.to.length + recipients.cc.length > 0;

  const send = () => {
    if (!canSend) return;
    onSend({ text: draft.text, mode, attachments: draft.attachments, replyToId: replyTo?.id });
    setDraft({ text: '', attachments: [], mode: draft.mode });
    setSuggestion(null);
    setPrevious(null);
    onClearReplyTo();
  };

  const polish = async () => {
    if (!draft.text.trim() || polishing) return;
    setPolishing(true);
    const result = await api.ai({ task: 'polish', threadId, draft: draft.text }).catch((error: Error) => ({ ok: false, error: error.message, text: undefined }));
    setPolishing(false);
    if (result.ok && result.text) setSuggestion(result.text);
    else onToast(result.error ?? 'Polish failed', 'error');
  };

  const addFiles = async () => {
    const files = await api.pickFiles();
    if (files.length) setDraft((current) => ({ ...current, attachments: mergeFiles(current.attachments, files) }));
  };

  const setMode = (next: ReplyMode) => setDraft((current) => ({ ...current, mode: next }));
  const totalSize = draft.attachments.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="composer">
      {suggestion && (
        <div className="suggestion">
          <div className="sg-head">
            <Icon name="wand" size={15} /> Polished version
            <span className="grow" />
            <button className="btn small ghost" onClick={() => setSuggestion(null)}>
              Keep mine
            </button>
            <button
              className="btn small primary"
              onClick={() => {
                setPrevious(draft.text);
                setDraft((current) => ({ ...current, text: suggestion }));
                setSuggestion(null);
                textRef.current?.focus();
              }}
            >
              Use this
            </button>
          </div>
          <div className="sg-text" dir="auto">
            {suggestion}
          </div>
        </div>
      )}
      <div className="audience">
        {replyTo ? (
          <span className="replying">
            <Icon name="reply" size={14} /> Replying to {replyTo.fromMe ? 'your email' : `${firstName(replyTo.from)}'s email`}
            <button className="icon-btn tiny" onClick={onClearReplyTo} aria-label="Cancel reply">
              <Icon name="x" size={13} />
            </button>
          </span>
        ) : null}
        <div className="seg" role="radiogroup" aria-label="Who gets this">
          <button role="radio" aria-checked={mode === 'all'} className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>
            <Icon name="users" size={14} /> Everyone{allCount ? ` (${allCount})` : ''}
          </button>
          <button role="radio" aria-checked={mode === 'sender'} className={mode === 'sender' ? 'on' : ''} onClick={() => setMode('sender')}>
            Only {senderName || 'sender'}
          </button>
        </div>
        <span className="to-preview" title={[...recipients.to, ...recipients.cc].map((p) => `${p.name} <${p.email}>`).join('\n')}>
          → {joinNames(recipients.to, 3)}
          {recipients.cc.length > 0 && <span className="muted"> · cc {joinNames(recipients.cc, 2)}</span>}
        </span>
      </div>
      {draft.attachments.length > 0 && (
        <div className="draft-files">
          {draft.attachments.map((file) => (
            <span key={file.path} className="draft-file" title={file.path}>
              <Icon name="file" size={14} />
              <span className="df-name">{file.name}</span>
              <span className="muted">{fileSize(file.size)}</span>
              <button
                className="icon-btn tiny"
                onClick={() => setDraft((current) => ({ ...current, attachments: current.attachments.filter((f) => f.path !== file.path) }))}
                aria-label={`Remove ${file.name}`}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          {totalSize > 25 * 1024 * 1024 && <span className="warn-text">Over 25 MB, Outlook may refuse it.</span>}
        </div>
      )}
      <div className="input-row">
        <button className="icon-btn" onClick={() => void addFiles()} title="Attach files">
          <Icon name="clip" />
        </button>
        <textarea
          ref={textRef}
          rows={1}
          dir="auto"
          value={draft.text}
          placeholder={mode === 'all' ? 'Message everyone…' : `Message ${senderName || 'sender'}…`}
          onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
            if (event.key === 'Escape' && replyTo) onClearReplyTo();
          }}
        />
        {aiEnabled && previous !== null && (
          <button
            className="icon-btn"
            title="Undo polish"
            onClick={() => {
              setDraft((current) => ({ ...current, text: previous }));
              setPrevious(null);
            }}
          >
            <Icon name="undo" />
          </button>
        )}
        {aiEnabled && (
          <button className={`icon-btn ai${polishing ? ' busy' : ''}`} onClick={() => void polish()} disabled={!draft.text.trim() || polishing} title="Polish: turn your quick text into a proper email">
            {polishing ? <span className="spinner small" /> : <Icon name="wand" />}
          </button>
        )}
        <button className="send-btn" onClick={send} disabled={!canSend} title="Send (Enter)">
          <Icon name="send" />
        </button>
      </div>
      <div className="hint">
        <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line{aiEnabled ? ' · ✨ wand = make it sound professional' : ''}
      </div>
    </div>
  );
}

function mergeFiles(current: OutgoingAttachment[], added: OutgoingAttachment[]): OutgoingAttachment[] {
  const seen = new Set(current.map((file) => file.path));
  return [...current, ...added.filter((file) => !seen.has(file.path))];
}
