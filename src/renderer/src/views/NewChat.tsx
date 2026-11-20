import { MOD } from '../platform';
import { useEffect, useRef, useState } from 'react';
import type { OutgoingAttachment, Person, PersonSuggestion } from '../../../shared/types';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Overlay';
import { fileSize } from '../lib/format';

const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

export function PeoplePicker({ label, people, onChange, autoFocus }: { label: string; people: Person[]; onChange: (people: Person[]) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<PersonSuggestion[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = text.trim();
    if (term.length < 1) {
      setOptions([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void api.searchPeople(term).then((found) => {
        if (!alive) return;
        const taken = new Set(people.map((p) => p.email.toLowerCase()));
        setOptions(found.filter((p) => !taken.has(p.email.toLowerCase())));
        setActive(0);
        setOpen(true);
      });
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text, people]);

  const add = (person: Person) => {
    if (!people.some((p) => p.email.toLowerCase() === person.email.toLowerCase())) onChange([...people, person]);
    setText('');
    setOptions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const commitTyped = () => {
    const value = text.trim().replace(/[,;]$/, '');
    if (EMAIL.test(value)) add({ name: value, email: value });
  };

  return (
    <label className="picker">
      <span className="picker-label">{label}</span>
      <div className="picker-box">
        {people.map((person) => (
          <span key={person.email} className="person-chip" title={person.email}>
            <Avatar person={person} size={20} />
            {person.name}
            <button type="button" className="icon-btn tiny" onClick={() => onChange(people.filter((p) => p !== person))} aria-label={`Remove ${person.name}`}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          spellCheck={false}
          placeholder={people.length ? '' : 'Name or email'}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => options.length && setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === 'Enter' || event.key === 'Tab' || event.key === ',' || event.key === ';') {
              if (open && options[active]) {
                event.preventDefault();
                add(options[active]);
              } else if (EMAIL.test(text.trim())) {
                event.preventDefault();
                commitTyped();
              }
            } else if (event.key === 'Backspace' && !text && people.length) {
              onChange(people.slice(0, -1));
            }
          }}
        />
      </div>
      {open && options.length > 0 && (
        <div className="suggest">
          {options.map((option, index) => (
            <button
              type="button"
              key={option.email}
              className={`suggest-item${index === active ? ' on' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault();
                add(option);
              }}
            >
              <Avatar person={option} size={28} />
              <span>
                <b>{option.name}</b>
                <span className="muted">{option.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

export function NewChat({ onClose, onSent, onToast }: { onClose: () => void; onSent: (threadId?: string) => void; onToast: (text: string, tone?: 'info' | 'error') => void }) {
  const [to, setTo] = useState<Person[]>([]);
  const [cc, setCc] = useState<Person[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<OutgoingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = to.length > 0 && subject.trim().length > 0 && text.trim().length > 0;

  const send = async () => {
    if (!valid || sending) return;
    setSending(true);
    setError(null);
    const result = await api.sendNew({ to, cc, subject, text, attachments: files });
    setSending(false);
    if (!result.ok) {
      setError(result.error ?? 'Send failed');
      return;
    }
    onToast('Sent. New chat created 🎉');
    onSent(result.threadId);
  };

  return (
    <Modal
      title="New chat"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="icon-btn" title="Attach files" onClick={() => void api.pickFiles().then((picked) => setFiles((list) => [...list, ...picked]))}>
            <Icon name="clip" />
          </button>
          <span className="muted small">{to.length + cc.length > 0 ? `${to.length + cc.length} recipient${to.length + cc.length === 1 ? '' : 's'}` : ''}</span>
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid || sending} onClick={() => void send()}>
            {sending ? <span className="spinner small" /> : <Icon name="send" size={16} />} Send
          </button>
        </>
      }
    >
      <div className="form">
        <PeoplePicker label="To" people={to} onChange={setTo} autoFocus />
        {showCc ? (
          <PeoplePicker label="Cc" people={cc} onChange={setCc} />
        ) : (
          <button className="link add-cc" onClick={() => setShowCc(true)}>
            + Add Cc (people who just need to know)
          </button>
        )}
        <label className="field">
          <span>Chat name (email subject)</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="e.g. Release plan for Thursday" />
        </label>
        <label className="field">
          <span>Message</span>
          <textarea
            rows={7}
            dir="auto"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={`Write it like a chat. ${MOD}+Enter sends.`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send();
            }}
          />
        </label>
        {files.length > 0 && (
          <div className="draft-files">
            {files.map((file) => (
              <span key={file.path} className="draft-file">
                <Icon name="file" size={14} />
                <span className="df-name">{file.name}</span>
                <span className="muted">{fileSize(file.size)}</span>
                <button className="icon-btn tiny" onClick={() => setFiles((list) => list.filter((f) => f.path !== file.path))} aria-label="Remove">
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {error && (
          <div className="form-error">
            <Icon name="alert" size={15} /> {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
