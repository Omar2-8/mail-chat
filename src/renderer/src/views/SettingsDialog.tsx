import { useEffect, useMemo, useState } from 'react';
import type { AiStatus } from '../../../shared/ipc';
import { signatureHtml } from '../../../shared/signature';
import type { OutlookSignature, Person, Settings } from '../../../shared/types';
import { THEME_NAMES } from '../../../shared/themes';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import { Icon, type IconName } from '../components/Icon';
import { Modal } from '../components/Overlay';
import { TagInput } from '../components/TagInput';
import { fileSize, listTime } from '../lib/format';
import { sanitizeSignature } from '../lib/html';
import { dndActive, dndLabel, pauseUntil } from '../lib/settings';

export type SettingsTab = 'general' | 'notifications' | 'signature' | 'ai';

const TABS: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'sliders' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'signature', label: 'Signature', icon: 'compose' },
  { id: 'ai', label: 'AI helpers', icon: 'sparkles' }
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Setter = <K extends keyof Settings>(name: K, value: Settings[K]) => void;

export function SettingsDialog({
  settings,
  me,
  initialTab = 'general',
  onClose,
  onSignOut
}: {
  settings: Settings;
  me?: Person;
  initialTab?: SettingsTab;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set: Setter = (name, value) => setDraft((current) => ({ ...current, [name]: value }));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveSettings(draft);
      onClose();
    } catch (e) {
      setSaveError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="settings-layout">
        <nav className="settings-tabs">
          {TABS.map((item) => (
            <button key={item.id} className={tab === item.id ? 'on' : ''} onClick={() => setTab(item.id)}>
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="form settings">
          {tab === 'general' && <General draft={draft} set={set} me={me} onSignOut={onSignOut} />}
          {tab === 'notifications' && <Notifications draft={draft} set={set} />}
          {tab === 'signature' && <Signature draft={draft} set={set} setDraft={setDraft} />}
          {tab === 'ai' && <Ai draft={draft} set={set} />}
          {saveError && (
            <div className="form-error">
              <Icon name="alert" size={15} /> {saveError}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function General({ draft, set, me, onSignOut }: { draft: Settings; set: Setter; me?: Person; onSignOut: () => void }) {
  return (
    <>
      {me && (
        <div className="account">
          <Avatar person={me} size={40} />
          <div>
            <b>{me.name}</b>
            <span className="muted">{me.email}</span>
          </div>
          <span className="grow" />
          <button className="btn small ghost danger" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
      <h4>Chats</h4>
      <label className="field inline">
        <span>Show emails from the last</span>
        <select value={draft.historyDays} onChange={(event) => set('historyDays', Number(event.target.value))}>
          {[7, 14, 30, 60, 90, 180].map((days) => (
            <option key={days} value={days}>
              {days} days
            </option>
          ))}
        </select>
      </label>
      <label className="field inline">
        <span>When I type, reply to</span>
        <select value={draft.defaultReplyMode} onChange={(event) => set('defaultReplyMode', event.target.value as Settings['defaultReplyMode'])}>
          <option value="all">Everyone in the chat (reply all)</option>
          <option value="sender">Only the last sender</option>
        </select>
      </label>
      <Toggle
        label="Trim emails to chat style (hide banners, greetings, sign-offs, signatures, 'Sent from…' and footers)"
        value={draft.chatTrim}
        onChange={(value) => set('chatTrim', value)}
      />
      <h4>App</h4>
      <Toggle label="Keep running in the tray when I close the window" value={draft.closeToTray} onChange={(value) => set('closeToTray', value)} />
      <Toggle label="Start with Windows" value={draft.startWithWindows} onChange={(value) => set('startWithWindows', value)} />
      <label className="field inline">
        <span>Theme</span>
        <select value={draft.theme} onChange={(event) => {
          const theme = THEME_NAMES.find((name) => name === event.target.value);
          if (theme) set('theme', theme);
        }}>
          <option value="system">Match Windows</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <optgroup label="Themes">
            <option value="midnight">Midnight</option>
            <option value="ocean">Ocean</option>
            <option value="forest">Forest</option>
            <option value="sunset">Sunset</option>
          </optgroup>
        </select>
      </label>
    </>
  );
}

function Notifications({ draft, set }: { draft: Settings; set: Setter }) {
  const paused = dndActive(draft);
  return (
    <>
      <Toggle label="Show desktop notifications for new emails" value={draft.notifications} onChange={(value) => set('notifications', value)} />
      {draft.notifications && (
        <>
          <h4>Do not disturb</h4>
          {paused ? (
            <div className="dnd-row">
              <span className="dnd-state">
                <Icon name="bellOff" size={16} /> {dndLabel(draft)}
              </span>
              <button className="btn small" onClick={() => set('dndUntil', '')}>
                Resume now
              </button>
            </div>
          ) : (
            <div className="dnd-row">
              <span className="muted">Pause everything for</span>
              <button className="btn small" onClick={() => set('dndUntil', pauseUntil('1h'))}>
                1 hour
              </button>
              <button className="btn small" onClick={() => set('dndUntil', pauseUntil('3h'))}>
                3 hours
              </button>
              <button className="btn small" onClick={() => set('dndUntil', pauseUntil('tomorrow'))}>
                Until tomorrow 8 AM
              </button>
              <button className="btn small" onClick={() => set('dndUntil', pauseUntil('forever'))}>
                Until I resume
              </button>
            </div>
          )}
          <div className="quiet-row">
            <Toggle label="Quiet hours every day" value={draft.quietHours} onChange={(value) => set('quietHours', value)} />
            {draft.quietHours && (
              <span className="time-range">
                from <input type="time" value={draft.quietFrom} onChange={(event) => set('quietFrom', event.target.value)} /> to{' '}
                <input type="time" value={draft.quietTo} onChange={(event) => set('quietTo', event.target.value)} />
              </span>
            )}
          </div>
          <div className="field">
            <span>Quiet all day on</span>
            <div className="day-chips">
              {DAYS.map((day, index) => {
                const on = draft.quietDays.includes(index);
                return (
                  <button
                    key={day}
                    className={`chip${on ? ' on' : ''}`}
                    onClick={() => set('quietDays', on ? draft.quietDays.filter((d) => d !== index) : [...draft.quietDays, index].sort())}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <h4>Silence these kinds of email</h4>
          <Toggle label="Newsletters and bot mail (the Other tab)" value={draft.silenceOther} onChange={(value) => set('silenceOther', value)} />
          <Toggle label="Automated senders (no-reply, alerts, DevOps, Jira…)" value={draft.silenceAutomated} onChange={(value) => set('silenceAutomated', value)} />
          <Toggle label="Emails where I'm only CC'd or on a list" value={draft.silenceFyi} onChange={(value) => set('silenceFyi', value)} />
          <Toggle label="People outside my company" value={draft.silenceExternal} onChange={(value) => set('silenceExternal', value)} />
          <Toggle label="Meeting invites and updates" value={draft.silenceMeetings} onChange={(value) => set('silenceMeetings', value)} />

          <h4>Muted people and companies</h4>
          <p className="help">An email address mutes one person. @company.com mutes everyone at that company.</p>
          <TagInput values={draft.mutedSenders} onChange={(values) => set('mutedSenders', values)} placeholder="name@company.com or @company.com" people />

          <h4>Muted words</h4>
          <p className="help">Any new email whose subject or first lines contain one of these stays quiet.</p>
          <TagInput values={draft.mutedKeywords} onChange={(values) => set('mutedKeywords', values)} placeholder="e.g. newsletter, weekly digest, [Build]" lower={false} />

          <h4>Always notify me about</h4>
          <p className="help">These people break through every rule above, quiet hours and Do not disturb.</p>
          <TagInput values={draft.vipSenders} onChange={(values) => set('vipSenders', values)} placeholder="e.g. your manager's email" people />

          <p className="help">To mute one chat, right-click it and choose Mute. To mute a person fast, hover their message, click ⋯ and choose Mute.</p>
        </>
      )}
    </>
  );
}

function Signature({ draft, set, setDraft }: { draft: Settings; set: Setter; setDraft: React.Dispatch<React.SetStateAction<Settings>> }) {
  const [outlook, setOutlook] = useState<OutlookSignature[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoInfo, setLogoInfo] = useState<string>('');
  const preview = useMemo(() => sanitizeSignature(signatureHtml(draft)), [draft]);

  useEffect(() => {
    void api.outlookSignatures().then(setOutlook, () => setOutlook([]));
  }, []);

  const pickLogo = async () => {
    setError(null);
    try {
      const image = await api.pickImage();
      if (!image) return;
      setDraft((current) => ({
        ...current,
        signatureLogo: image.dataUrl,
        signatureLogoRatio: image.width > 0 && image.height > 0 ? image.width / image.height : 1,
        signatureLogoHeight: Math.min(current.signatureLogoHeight || 48, image.height || 48)
      }));
      setLogoInfo(`${image.width}×${image.height} · ${fileSize(image.bytes)}${image.bytes > 200_000 ? ' · big for email, under 200 KB is better' : ''}`);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  const importOutlook = async (name: string) => {
    setError(null);
    try {
      const html = sanitizeSignature(await api.importOutlookSignature(name));
      setDraft((current) => ({ ...current, signatureMode: 'html', signatureHtml: html, signatureSource: name }));
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  return (
    <>
      <div className="seg big" role="radiogroup" aria-label="Signature type">
        {(
          [
            ['none', 'No signature'],
            ['simple', 'Text + logo'],
            ['html', 'From Outlook']
          ] as const
        ).map(([mode, label]) => (
          <button key={mode} role="radio" aria-checked={draft.signatureMode === mode} className={draft.signatureMode === mode ? 'on' : ''} onClick={() => set('signatureMode', mode)}>
            {label}
          </button>
        ))}
      </div>

      {draft.signatureMode === 'simple' && (
        <>
          <label className="field">
            <span>Text</span>
            <textarea rows={4} value={draft.signature} onChange={(event) => set('signature', event.target.value)} placeholder={'Alex Morgan\nSoftware Engineer · Northwind Labs\n+1 555 0100'} />
          </label>
          <div className="field">
            <span>Logo</span>
            <div className="logo-row">
              {draft.signatureLogo ? (
                <img className="logo-thumb" src={draft.signatureLogo} alt="" />
              ) : (
                <span className="logo-empty">
                  <Icon name="image" size={20} />
                </span>
              )}
              <button className="btn small" onClick={() => void pickLogo()}>
                {draft.signatureLogo ? 'Change' : 'Add logo'}
              </button>
              {draft.signatureLogo && (
                <button className="btn small ghost danger" onClick={() => set('signatureLogo', '')}>
                  Remove
                </button>
              )}
              {logoInfo && <span className="muted small">{logoInfo}</span>}
            </div>
          </div>
          {draft.signatureLogo && (
            <>
              <label className="field inline">
                <span>Logo height</span>
                <span className="range">
                  <input type="range" min={20} max={140} value={draft.signatureLogoHeight} onChange={(event) => set('signatureLogoHeight', Number(event.target.value))} />
                  <span className="muted small">{draft.signatureLogoHeight}px</span>
                </span>
              </label>
              <label className="field inline">
                <span>Logo position</span>
                <select value={draft.signatureLayout} onChange={(event) => set('signatureLayout', event.target.value as Settings['signatureLayout'])}>
                  <option value="below">Under the text</option>
                  <option value="left">Left of the text</option>
                </select>
              </label>
              <label className="field">
                <span>Logo links to (optional)</span>
                <input value={draft.signatureLogoLink} onChange={(event) => set('signatureLogoLink', event.target.value)} placeholder="https://example.com" spellCheck={false} />
              </label>
            </>
          )}
        </>
      )}

      {draft.signatureMode === 'html' && (
        <div className="field">
          <span>Pick one of your Outlook signatures{draft.signatureSource ? ` (using "${draft.signatureSource}")` : ''}</span>
          {outlook === null && <span className="muted small">Looking…</span>}
          {outlook && outlook.length === 0 && <span className="muted small">No Outlook signatures found on this PC. Use Text + logo instead.</span>}
          <div className="sig-list">
            {outlook?.map((item) => (
              <button key={item.name} className={`sig-item${draft.signatureSource === item.name ? ' on' : ''}`} onClick={() => void importOutlook(item.name)}>
                <b>{item.name}</b>
                <span className="muted small">edited {listTime(item.modified)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="form-error">
          <Icon name="alert" size={15} /> {error}
        </div>
      )}

      {draft.signatureMode !== 'none' && (
        <div className="field">
          <span>Preview</span>
          <div className="sig-preview">
            <div className="sig-preview-body">
              <p>Sure, I'll have it ready by Thursday.</p>
              {preview ? <div dangerouslySetInnerHTML={{ __html: preview }} /> : <p className="muted">Your signature shows here.</p>}
            </div>
          </div>
          <span className="muted small">Images go out as embedded pictures, so they show up in Outlook, Gmail and phones.</span>
        </div>
      )}
    </>
  );
}

function Ai({ draft, set }: { draft: Settings; set: Setter }) {
  const [ai, setAi] = useState<AiStatus | null>(null);
  useEffect(() => {
    void api.aiStatus().then(setAi);
  }, []);
  return (
    <>
      <Toggle label="Turn on TL;DR, Explain and Polish (uses Claude Code on this PC)" value={draft.aiEnabled} onChange={(value) => set('aiEnabled', value)} />
      {draft.aiEnabled && (
        <>
          <label className="field inline">
            <span>Model</span>
            <select value={draft.aiModel} onChange={(event) => set('aiModel', event.target.value)}>
              <option value="haiku">Haiku (fastest)</option>
              <option value="sonnet">Sonnet (smarter)</option>
              <option value="opus">Opus (smartest, slowest)</option>
            </select>
          </label>
          <label className="field">
            <span>Claude Code path (leave empty to find it automatically)</span>
            <input value={draft.claudePath} onChange={(event) => set('claudePath', event.target.value)} placeholder={ai?.path ?? 'claude.exe'} spellCheck={false} />
          </label>
          <p className={`status-line ${ai?.available ? 'ok' : 'bad'}`}>{ai ? (ai.available ? `Found Claude Code at ${ai.path}` : ai.error) : 'Checking…'}</p>
        </>
      )}
    </>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
