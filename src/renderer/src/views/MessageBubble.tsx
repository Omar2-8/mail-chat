import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AttachmentInfo, ChatMessage, Person } from '../../../shared/types';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import { Icon, type IconName } from '../components/Icon';
import { Menu } from '../components/Overlay';
import { clockTime, fileSize, firstName, fullTime, hueOf, joinNames } from '../lib/format';
import { cleanEmailHtml, plainText } from '../lib/html';
import type { Audience } from '../lib/people';
import { senderDomain, toggleEntry, useSettings } from '../lib/settings';

const COLLAPSE_AT = 460;
const inlineCache = new Map<string, Promise<Record<string, string>>>();
const attachmentCache = new Map<string, Promise<AttachmentInfo[]>>();

function inlineImages(messageId: string): Promise<Record<string, string>> {
  let pending = inlineCache.get(messageId);
  if (!pending) {
    // Do not keep a failed or empty lookup, so the next render can try again.
    pending = api
      .inlineImages(messageId)
      .then((found) => {
        if (Object.keys(found).length === 0) inlineCache.delete(messageId);
        return found;
      })
      .catch(() => {
        inlineCache.delete(messageId);
        return {} as Record<string, string>;
      });
    inlineCache.set(messageId, pending);
  }
  return pending;
}

function attachments(messageId: string): Promise<AttachmentInfo[]> {
  let pending = attachmentCache.get(messageId);
  if (!pending) {
    pending = api.attachments(messageId).catch(() => {
      attachmentCache.delete(messageId);
      return [];
    });
    attachmentCache.set(messageId, pending);
  }
  return pending;
}

function fileIcon(attachment: AttachmentInfo): IconName {
  if (attachment.contentType.startsWith('image/')) return 'image';
  if (attachment.contentType.includes('calendar')) return 'calendar';
  return 'file';
}

function extension(name: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  return match ? match[1].toUpperCase() : '';
}

const AUDIENCE_LABEL: Partial<Record<Audience, { text: string; title: string }>> = {
  cc: { text: "cc'd you", title: "You're only in CC. Usually means FYI, no action expected." },
  'only-you': { text: 'just you', title: 'Sent only to you, not the whole group.' },
  bcc: { text: 'via list', title: 'You got this through a distribution list or BCC.' }
};

export interface BubbleProps {
  message: ChatMessage;
  first: boolean;
  last: boolean;
  audience: Audience;
  aiEnabled: boolean;
  onReply: (message: ChatMessage) => void;
  onExplain: (message: ChatMessage) => void;
  onToast: (text: string, tone?: 'info' | 'error') => void;
}

export const MessageBubble = memo(function MessageBubble({ message, first, last, audience, aiEnabled, onReply, onExplain, onToast }: BubbleProps) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tall, setTall] = useState(false);
  const [files, setFiles] = useState<AttachmentInfo[]>([]);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const { settings, me, update } = useSettings();
  const [showPeople, setShowPeople] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  const trim = settings.chatTrim && !original;
  const cleaned = useMemo(
    () => cleanEmailHtml(original ? message.fullHtml : message.html, images, { trim }),
    [message.html, message.fullHtml, original, images, trim]
  );

  useEffect(() => {
    if (!cleaned.hasCid || Object.keys(images).length > 0) return;
    let alive = true;
    void inlineImages(message.id).then((found) => alive && Object.keys(found).length > 0 && setImages(found));
    return () => {
      alive = false;
    };
  }, [cleaned.hasCid, message.id, images]);

  useEffect(() => {
    if (!message.hasAttachments) return;
    let alive = true;
    void attachments(message.id).then((list) => alive && setFiles(list.filter((file) => !file.isInline)));
    return () => {
      alive = false;
    };
  }, [message.id, message.hasAttachments]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setTall(body.scrollHeight > COLLAPSE_AT + 80);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [cleaned.html]);

  const mine = message.fromMe;
  const collapsed = tall && !expanded;
  const label = AUDIENCE_LABEL[audience];
  const recipients = [...message.to, ...message.cc];
  const nameStyle = { '--h': hueOf(message.from.email || message.from.name) } as React.CSSProperties;

  const senderEmail = message.from.email.toLowerCase();
  const domain = senderDomain(senderEmail);
  const myDomain = senderDomain(me?.email ?? '');
  const senderMuted = settings.mutedSenders.includes(senderEmail);
  const domainMuted = settings.mutedSenders.includes(`@${domain}`);
  const senderVip = settings.vipSenders.includes(senderEmail);
  const who = firstName(message.from);
  const senderItems = mine || !senderEmail
    ? []
    : [
        {
          label: senderMuted ? `Unmute ${who}` : `Mute ${who}`,
          icon: (senderMuted ? 'bell' : 'bellOff') as IconName,
          onSelect: () => {
            void update({ mutedSenders: toggleEntry(settings.mutedSenders, senderEmail, !senderMuted) });
            onToast(senderMuted ? `${who} can ping you again` : `Muted ${who}. Undo in Settings, Notifications.`);
          }
        },
        ...(domain && domain !== myDomain
          ? [
              {
                label: domainMuted ? `Unmute everyone at @${domain}` : `Mute everyone at @${domain}`,
                icon: (domainMuted ? 'bell' : 'bellOff') as IconName,
                onSelect: () => {
                  void update({ mutedSenders: toggleEntry(settings.mutedSenders, `@${domain}`, !domainMuted) });
                  onToast(domainMuted ? `@${domain} unmuted` : `Muted everyone at @${domain}`);
                }
              }
            ]
          : []),
        {
          label: senderVip ? `Stop always notifying about ${who}` : `Always notify me about ${who}`,
          icon: 'alert' as IconName,
          onSelect: () => {
            void update({ vipSenders: toggleEntry(settings.vipSenders, senderEmail, !senderVip) });
            onToast(senderVip ? `${who} follows your normal rules again` : `${who} now breaks through quiet hours and mutes`);
          }
        }
      ];

  const copyText = () => {
    void navigator.clipboard.writeText(plainText(cleaned.html));
    onToast('Copied');
  };

  return (
    <div className={`msg${mine ? ' mine' : ''}${first ? ' first' : ''}${last ? ' last' : ''}`} data-id={message.id}>
      {!mine && <div className="msg-avatar">{first ? <Avatar person={message.from} size={34} /> : null}</div>}
      <div className="msg-col">
        {first && (
          <div className="msg-meta">
            {!mine && (
              <span className="msg-name" style={nameStyle}>
                {message.from.name}
              </span>
            )}
            {label && (
              <span className="pill soft" title={label.title}>
                {label.text}
              </span>
            )}
            {message.historical && (
              <span className="pill soft" title="This email isn't in your mailbox. It's quoted inside a later email in this thread, usually from before you were added.">
                earlier history
              </span>
            )}
          </div>
        )}
        <div className="bubble-wrap">
          <div className={`bubble${message.kind === 'meeting' ? ' meeting' : ''}${message.importance === 'high' ? ' high' : ''}`}>
            {message.kind === 'forward' && (
              <div className="bubble-kind">
                <Icon name="forward" size={14} /> Forwarded
              </div>
            )}
            {message.kind === 'meeting' && (
              <div className="bubble-kind">
                <Icon name="calendar" size={14} /> Meeting · {message.subject.replace(/^[^:]{0,20}:\s*/, '')}
              </div>
            )}
            {message.importance === 'high' && <div className="bubble-kind hot">❗ Marked important</div>}
            <div className={`bubble-body${collapsed ? ' collapsed' : ''}`} ref={bodyRef} dir="auto" dangerouslySetInnerHTML={{ __html: cleaned.html || '<p class="empty-body">(empty email)</p>' }} />
            {tall && (
              <button className="more-btn" onClick={() => setExpanded((value) => !value)}>
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
            {files.length > 0 && (
              <div className="files">
                {files.map((file) => (
                  <div key={file.id} className="file" title={file.name}>
                    <button className="file-main" onClick={() => void api.openAttachment(message.id, file.id, file.name).catch((e: Error) => onToast(e.message, 'error'))}>
                      <span className="file-icon">
                        <Icon name={fileIcon(file)} size={18} />
                        {extension(file.name) && <em>{extension(file.name)}</em>}
                      </span>
                      <span className="file-text">
                        <span className="file-name">{file.name}</span>
                        <span className="file-size">{fileSize(file.size)}</span>
                      </span>
                    </button>
                    <button className="icon-btn tiny" title="Save as…" onClick={() => void api.saveAttachment(message.id, file.id, file.name).catch((e: Error) => onToast(e.message, 'error'))}>
                      <Icon name="download" size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="bubble-foot">
              <button className="to-line" onClick={() => setShowPeople((value) => !value)} title="Who got this">
                {mine ? 'to ' : 'to '}
                {joinNames(message.to.length ? message.to : recipients, 2)}
                {message.cc.length > 0 && ` · cc ${message.cc.length}`}
              </button>
              <span className="time" title={fullTime(message.sentAt)}>
                {clockTime(message.sentAt)}
              </span>
              {original && <span className="pill soft">original</span>}
            </div>
            {showPeople && (
              <div className="people-pop">
                <PeopleList label="To" people={message.to} />
                {message.cc.length > 0 && <PeopleList label="Cc" people={message.cc} />}
              </div>
            )}
          </div>
          <div className="hover-bar">
            {!message.historical && (
              <button className="icon-btn tiny" title={`Reply to ${mine ? 'this' : firstName(message.from)}`} onClick={() => onReply(message)}>
                <Icon name="reply" size={15} />
              </button>
            )}
            {aiEnabled && !message.historical && (
              <button className="icon-btn tiny ai" title="Explain this email" onClick={() => onExplain(message)}>
                <Icon name="sparkles" size={15} />
              </button>
            )}
            <button ref={moreRef} className="icon-btn tiny" title="More" onClick={() => setMenu(moreRef.current?.getBoundingClientRect() ?? null)}>
              <Icon name="more" size={15} />
            </button>
          </div>
        </div>
      </div>
      {menu && (
        <Menu
          anchor={menu}
          align={mine ? 'end' : 'start'}
          onClose={() => setMenu(null)}
          items={[
            { label: original ? 'Show chat view' : 'Show original email', icon: 'eye', onSelect: () => setOriginal((value) => !value) },
            { label: 'Copy text', icon: 'copy', onSelect: copyText },
            ...(message.webLink ? [{ label: 'Open in Outlook', icon: 'external' as const, onSelect: () => void api.openExternal(message.webLink!) }] : []),
            ...senderItems
          ]}
        />
      )}
    </div>
  );
});

function PeopleList({ label, people }: { label: string; people: Person[] }) {
  return (
    <div className="pl">
      <span className="pl-label">{label}</span>
      <div className="pl-items">
        {people.map((person) => (
          <span key={person.email || person.name} className="pl-item" title={person.email}>
            <Avatar person={person} size={18} />
            {person.name}
          </span>
        ))}
      </div>
    </div>
  );
}
