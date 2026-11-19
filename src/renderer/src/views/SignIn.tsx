import { useEffect, useState } from 'react';
import type { AccountKind, AuthErrorInfo, AuthState } from '../../../shared/types';
import { api } from '../api';
import { Icon } from '../components/Icon';

function useCountdown(expiresAt?: string): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return '';
  const left = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

export function SignIn({ auth }: { auth: AuthState }) {
  const countdown = useCountdown(auth.device?.expiresAt);
  const [copied, setCopied] = useState(false);
  const [kind, setKind] = useState<AccountKind>('work');
  const start = (next: AccountKind) => {
    setKind(next);
    void api.signIn(next);
  };
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="signin-bubbles" aria-hidden="true">
          <div className="sb sb-in">RE: RE: FW: Q3 sync??</div>
          <div className="sb sb-in sb-2">per my last email…</div>
          <div className="sb sb-out">ok but make it a chat 💬</div>
        </div>
        <h1>
          Your inbox,
          <br />
          <span className="grad">but it's a group chat.</span>
        </h1>
        <p className="signin-sub">
          Every email thread becomes a group. Every email becomes a message. Type to reply all. That's it.
        </p>
        {auth.errorInfo ? (
          <ErrorCard info={auth.errorInfo} onDismiss={() => void api.cancelSignIn()} />
        ) : (
          auth.error && (
            <div className="signin-error">
              <Icon name="alert" size={16} /> {auth.error}
            </div>
          )
        )}
        {auth.device ? (
          <div className="device">
            <p>
              Open <button className="link" onClick={() => void api.openExternal(auth.device!.verificationUri)}>{auth.device.verificationUri}</button> and enter
            </p>
            <button
              className="device-code"
              onClick={() => {
                void navigator.clipboard.writeText(auth.device!.userCode);
                setCopied(true);
              }}
              title="Copy code"
            >
              {auth.device.userCode}
              <Icon name={copied ? 'check' : 'copy'} size={18} />
            </button>
            <p className="muted">Code expires in {countdown}. Waiting for you…</p>
            <button className="btn ghost" onClick={() => void api.cancelSignIn()}>
              Cancel
            </button>
          </div>
        ) : auth.busy ? (
          <div className="device">
            <div className="spinner big" />
            <p className="muted">Finish signing in in your browser…</p>
            <div className="row-center">
              <button className="btn ghost" onClick={() => void api.signInWithCode(kind)}>
                Use a code instead
              </button>
              <button className="btn ghost" onClick={() => void api.cancelSignIn()}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="signin-actions">
            <div className="signin-choice">
              <button className="btn primary big" onClick={() => start('work')}>
                <MsLogo /> Sign in with a work or school account
              </button>
              <span className="signin-hint">Microsoft 365, Office 365</span>
            </div>
            <div className="signin-choice">
              <button className="btn outline big" onClick={() => start('personal')}>
                <MsLogo /> Sign in with a personal account
              </button>
              <span className="signin-hint">Outlook.com, Hotmail, Live</span>
            </div>
            <button className="link" onClick={() => void api.signInWithCode(kind)}>
              Browser not cooperating? Use a code instead
            </button>
          </div>
        )}
        <p className="fineprint">
          <Icon name="lock" size={13} /> Talks straight to Microsoft 365 from this PC. Your mail stays in Outlook; this is just a nicer window on it.
        </p>
      </div>
    </div>
  );
}

function ErrorCard({ info, onDismiss }: { info: AuthErrorInfo; onDismiss: () => void }) {
  const [done, setDone] = useState(false);
  useEffect(() => setDone(false), [info]);
  const copy = () => {
    void navigator.clipboard
      .writeText(info.details)
      .then(() => setDone(true))
      .catch(() => setDone(false));
  };
  return (
    <div className="signin-error-card" role="alert">
      <div className="signin-error-head">
        <Icon name="alert" size={16} />
        <strong>{info.title}</strong>
      </div>
      <p>{info.hint}</p>
      <details className="signin-error-details">
        <summary>Technical details</summary>
        {info.code && <div className="signin-error-code">{info.code}</div>}
        <pre>{info.details}</pre>
      </details>
      <div className="signin-error-actions">
        <button className="btn outline small" onClick={copy}>
          <Icon name={done ? 'check' : 'copy'} size={14} /> {done ? 'Copied' : 'Copy details for IT'}
        </button>
        <button className="btn ghost small" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function MsLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
