import { useState } from 'react';
import type { GroupSummary, ThreadSummary } from '../../../shared/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Overlay';
import { hueOf } from '../lib/format';

export function MoveToGroup({
  thread,
  groups,
  onClose,
  onDone
}: {
  thread: ThreadSummary;
  groups: GroupSummary[];
  onClose: () => void;
  onDone: (text: string, tone?: 'info' | 'error') => void;
}) {
  const choices = groups.filter((group) => group.id !== thread.groupId);
  const [selected, setSelected] = useState<string | 'new'>(choices[0]?.id ?? 'new');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      const target = selected === 'new' ? await api.createGroup(name) : selected;
      await api.moveToGroup(thread.id, target);
      const label = selected === 'new' ? name.trim() : groups.find((group) => group.id === target)?.name;
      onDone(`Moved to "${label}". It's in the same folder in Outlook.`);
      onClose();
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Move to a group"
      onClose={onClose}
      footer={
        <>
          <span className="muted small">Moves the emails into that Outlook folder.</span>
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || (selected === 'new' && !name.trim())} onClick={() => void move()}>
            {busy ? <span className="spinner small" /> : null} Move
          </button>
        </>
      }
    >
      <div className="form">
        <p className="help" dir="auto">
          {thread.subject}
        </p>
        <div className="group-picker">
          {choices.map((group) => (
            <label key={group.id} className={`group-choice${selected === group.id ? ' on' : ''}`}>
              <input type="radio" name="group" checked={selected === group.id} onChange={() => setSelected(group.id)} />
              <span className="folder-badge small" style={{ '--h': hueOf(group.name) } as React.CSSProperties}>
                <Icon name="inbox" size={14} />
              </span>
              <span className="grow" dir="auto">
                {group.name}
              </span>
              {group.silent && <Icon name="bellOff" size={14} />}
            </label>
          ))}
          <label className={`group-choice${selected === 'new' ? ' on' : ''}`}>
            <input type="radio" name="group" checked={selected === 'new'} onChange={() => setSelected('new')} />
            <span className="folder-badge small new">
              <Icon name="folderPlus" size={14} />
            </span>
            <input
              className="grow plain-input"
              placeholder="New group name"
              value={name}
              onFocus={() => setSelected('new')}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim()) void move();
              }}
            />
          </label>
        </div>
        {selected === 'new' && <p className="help">New groups start silent, like your Outlook folders. Turn notifications on from the group's bell.</p>}
        {error && (
          <div className="form-error">
            <Icon name="alert" size={15} /> {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
