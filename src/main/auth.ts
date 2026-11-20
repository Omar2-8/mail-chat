import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-node';
import type { AccountInfo, AuthenticationResult, DeviceCodeRequest, ICachePlugin } from '@azure/msal-node';
import { app as electronApp } from 'electron';
import type { AccountKind, AuthErrorInfo, AuthState } from '../shared/types';

const DEFAULT_CLIENT_ID = 'c013199a-9f43-4212-b949-c8633efb8146';
export const TENANT_ID = process.env.MAIL_CHAT_TENANT_ID?.trim() || 'organizations';
export const CLIENT_ID = process.env.MAIL_CHAT_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
export const PERSONAL_CLIENT_ID = process.env.MAIL_CHAT_PERSONAL_CLIENT_ID?.trim() || CLIENT_ID;
export const WORK_SCOPES = ['User.Read', 'User.ReadBasic.All', 'People.Read', 'Mail.ReadWrite', 'Mail.Send'];
export const PERSONAL_SCOPES = ['User.Read', 'Mail.ReadWrite', 'Mail.Send'];
const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

const NOT_SIGNED_IN = 'Not signed in.';
const EXPIRED = 'Your Microsoft sign-in expired. Sign in again.';
const INTERACTION_CODES = new Set([
  'invalid_grant',
  'interaction_required',
  'consent_required',
  'login_required',
  'no_tokens_found',
  'refresh_token_expired'
]);

const SUCCESS_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Mail Chat</title></head>
<body style="font-family:Segoe UI,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#101018;color:#fff">
<div style="text-align:center"><div style="font-size:56px">✅</div><h1 style="font-weight:600">You're in.</h1><p style="opacity:.7">Head back to Mail Chat. You can close this tab.</p></div></body></html>`;

const ERROR_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Mail Chat</title></head>
<body style="font-family:Segoe UI,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#101018;color:#fff">
<div style="text-align:center"><div style="font-size:56px">😵</div><h1 style="font-weight:600">Sign-in failed</h1><p style="opacity:.7">Go back to Mail Chat and try "Use a code instead".</p></div></body></html>`;

export interface AuthOptions {
  cachePath: string;
  protect: (plain: string) => Buffer;
  unprotect: (data: Buffer) => string;
  openBrowser: (url: string) => Promise<void>;
}

export class Auth {
  private readonly apps = new Map<AccountKind, PublicClientApplication>();
  private readonly listeners = new Set<(state: AuthState) => void>();
  private current: AuthState = { signedIn: false, busy: false };
  private deviceRequest?: DeviceCodeRequest;
  private attempt = 0;

  constructor(private readonly opts: AuthOptions) {}

  get state(): AuthState {
    return this.current;
  }

  onChange(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async init(): Promise<void> {
    const account = await this.account();
    if (!account) return this.set({ signedIn: false, busy: false });
    try {
      await this.pca(kindOf(account)).acquireTokenSilent({ account, scopes: scopesFor(kindOf(account)) });
      this.set(signedInState(account));
    } catch (error) {
      if (isInteractionRequired(error)) return this.set(failedState(error, kindOf(account), 'silent', account));
      this.set(signedInState(account));
    }
  }

  async signIn(kind: AccountKind = 'work'): Promise<void> {
    const attempt = this.begin();
    try {
      const result = await this.pca(kind).acquireTokenInteractive({
        scopes: scopesFor(kind),
        prompt: 'select_account',
        openBrowser: this.opts.openBrowser,
        successTemplate: SUCCESS_PAGE,
        errorTemplate: ERROR_PAGE
      });
      if (attempt === this.attempt) await this.complete(result, kind);
    } catch (error) {
      if (attempt === this.attempt) this.set(failedState(error, kind, 'browser'));
    }
  }

  async signInWithCode(kind: AccountKind = 'work'): Promise<void> {
    const attempt = this.begin();
    const request: DeviceCodeRequest = {
      scopes: scopesFor(kind),
      deviceCodeCallback: (info) => {
        if (attempt !== this.attempt) return;
        const expires = Number.isFinite(info.expiresIn) ? info.expiresIn : 900;
        this.set({
          ...this.current,
          busy: true,
          device: {
            userCode: info.userCode,
            verificationUri: info.verificationUri,
            expiresAt: new Date(Date.now() + expires * 1000).toISOString()
          }
        });
      }
    };
    this.deviceRequest = request;
    try {
      const result = await this.pca(kind).acquireTokenByDeviceCode(request);
      if (attempt === this.attempt) await this.complete(result, kind);
    } catch (error) {
      if (attempt === this.attempt) this.set(failedState(error, kind, 'code'));
    }
  }

  cancel(): void {
    this.attempt++;
    if (this.deviceRequest) this.deviceRequest.cancel = true;
    this.deviceRequest = undefined;
    this.set({ signedIn: false, busy: false });
  }

  async signOut(): Promise<void> {
    this.cancel();
    const cache = this.pca('work').getTokenCache();
    for (const account of await cache.getAllAccounts()) await this.pca(kindOf(account)).getTokenCache().removeAccount(account);
    await rm(this.opts.cachePath, { force: true });
    this.set({ signedIn: false, busy: false });
  }

  async token(): Promise<string> {
    const account = await this.account();
    if (!account) throw new Error(NOT_SIGNED_IN);
    const kind = kindOf(account);
    try {
      const result = await this.pca(kind).acquireTokenSilent({ account, scopes: scopesFor(kind) });
      if (!this.current.signedIn) this.set(signedInState(account));
      return result.accessToken;
    } catch (error) {
      if (isInteractionRequired(error)) {
        this.set(failedState(error, kind, 'silent', account));
        throw new Error(EXPIRED);
      }
      throw new Error(`Could not reach Microsoft: ${describe(error)}`);
    }
  }

  private begin(): number {
    this.attempt++;
    if (this.deviceRequest) this.deviceRequest.cancel = true;
    this.deviceRequest = undefined;
    this.set({ signedIn: false, busy: true });
    return this.attempt;
  }

  private async complete(result: AuthenticationResult | null, requested: AccountKind): Promise<void> {
    this.deviceRequest = undefined;
    if (!result?.account) return this.set(failedState(Object.assign(new Error('Sign-in returned no account'), { errorCode: 'user_cancelled' }), requested, 'browser'));
    const cache = this.pca(requested).getTokenCache();
    for (const account of await cache.getAllAccounts()) {
      if (account.homeAccountId !== result.account.homeAccountId) await this.pca(kindOf(account)).getTokenCache().removeAccount(account);
    }
    this.set(signedInState(result.account));
  }

  private pca(kind: AccountKind): PublicClientApplication {
    let app = this.apps.get(kind);
    if (!app) {
      app = new PublicClientApplication({
        auth: { clientId: clientIdFor(kind), authority: authorityFor(kind) },
        cache: { cachePlugin: this.cachePlugin() }
      });
      this.apps.set(kind, app);
    }
    return app;
  }

  private set(state: AuthState): void {
    this.current = state;
    for (const listener of [...this.listeners]) listener(state);
  }

  private async account(): Promise<AccountInfo | undefined> {
    const accounts = await this.pca('work').getTokenCache().getAllAccounts();
    return accounts[0];
  }

  private cachePlugin(): ICachePlugin {
    return {
      beforeCacheAccess: async (context) => {
        const bytes = await readFile(this.opts.cachePath).catch(() => undefined);
        if (!bytes?.length) return;
        try {
          context.tokenCache.deserialize(this.opts.unprotect(bytes));
        } catch {
          await rm(this.opts.cachePath, { force: true });
        }
      },
      afterCacheAccess: async (context) => {
        if (!context.cacheHasChanged) return;
        const data = this.opts.protect(context.tokenCache.serialize());
        const temp = `${this.opts.cachePath}.${randomUUID()}.tmp`;
        await mkdir(dirname(this.opts.cachePath), { recursive: true });
        await writeFile(temp, data);
        await rename(temp, this.opts.cachePath).catch(async () => {
          await writeFile(this.opts.cachePath, data);
          await rm(temp, { force: true });
        });
      }
    };
  }
}

function kindOf(account: AccountInfo): AccountKind {
  return account.tenantId?.toLowerCase() === CONSUMER_TENANT_ID ? 'personal' : 'work';
}

// One link that works for any organization: the admin signs in and approves the app for their whole tenant.
function adminConsentUrl(): string {
  return `https://login.microsoftonline.com/common/adminconsent?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent('http://localhost')}`;
}

function clientIdFor(kind: AccountKind): string {
  return kind === 'personal' ? PERSONAL_CLIENT_ID : CLIENT_ID;
}

function authorityFor(kind: AccountKind): string {
  return `https://login.microsoftonline.com/${kind === 'personal' ? 'consumers' : TENANT_ID}`;
}

type Flow = 'browser' | 'code' | 'silent';

function failedState(error: unknown, kind: AccountKind, flow: Flow, account?: AccountInfo): AuthState {
  const errorInfo = explainAuthError(error, kind, flow);
  const state: AuthState = { signedIn: false, busy: false, error: errorInfo.title, errorInfo };
  if (account) {
    state.account = personOf(account);
    state.accountKind = kind;
  }
  return state;
}

interface ErrorFacts {
  codes: string[];
  aadsts: Set<string>;
  text: string;
  message: string;
}

function factsOf(error: unknown): ErrorFacts {
  const record = (error ?? {}) as { errorCode?: unknown; subError?: unknown; errorMessage?: unknown; message?: unknown; code?: unknown };
  const pick = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const message = pick(record.errorMessage) || pick(record.message) || (typeof error === 'string' ? error : '');
  const named = [pick(record.errorCode), pick(record.subError), pick(record.code)].filter(Boolean);
  const aadsts = new Set<string>();
  for (const match of message.matchAll(/AADSTS(\d+)/gi)) aadsts.add(match[1]);
  const codes = [...[...aadsts].map((id) => `AADSTS${id}`), ...named.filter((code, index) => named.indexOf(code) === index)];
  return { codes, aadsts, text: `${named.join(' ')} ${message}`.toLowerCase(), message };
}

function redact(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[removed]')
    .replace(/\b(access_token|refresh_token|id_token|client_secret|password|passwd|device_code|user_code|authorization_code|auth_code|assertion)(["']?\s*[=:]\s*["']?)[^\s"'&,;]+/gi, '$1$2[removed]');
}

function detailsOf(facts: ErrorFacts, title: string, kind: AccountKind, flow: Flow): string {
  const message = redact(facts.message.replace(/\s+/g, ' ').trim());
  const clipped = message.length > 600 ? `${message.slice(0, 600)}...` : message;
  return [
    'Mail Chat sign-in details',
    `Problem: ${title}`,
    `Error codes: ${facts.codes.length ? facts.codes.join(', ') : 'none'}`,
    `Message: ${clipped || 'none'}`,
    `Account type tried: ${kind === 'personal' ? 'personal' : 'work or school'}`,
    `Sign-in method: ${flow === 'code' ? 'device code' : flow === 'silent' ? 'silent refresh' : 'browser'}`,
    `Authority: ${authorityFor(kind)}`,
    `Client ID: ${clientIdFor(kind)}`,
    `App version: ${electronApp.getVersion()}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Time: ${new Date().toISOString()}`
  ].join('\n');
}

function classify(facts: ErrorFacts, kind: AccountKind): { title: string; hint: string } | undefined {
  const has = (...ids: string[]) => ids.some((id) => facts.aadsts.has(id));
  const says = (...needles: string[]) => needles.some((needle) => facts.text.includes(needle));
  const other = kind === 'personal' ? 'work or school' : 'personal';

  if (says('user_cancelled', 'user cancelled', 'user canceled', 'window closed', 'window was closed') || has('65004')) {
    return { title: 'Sign-in was cancelled', hint: 'Press the button to try again.' };
  }
  if (says('expired_token', 'code_expired', 'device code has expired', 'device code expired') || (has('70019', '70020') && says('device'))) {
    return { title: 'The code expired', hint: 'Press a sign-in button to get a new code and try again.' };
  }
  if (has('65001', '90094', '900941') || says('consent_required', 'needs admin approval', 'admin approval')) {
    return {
      title: 'Your organization needs to approve Mail Chat',
      hint: 'Ask your IT admin to approve Mail Chat and send them the details below. This is not a problem with your password.'
    };
  }
  if (has('53003', '530003', '53000', '50097') || says('conditional access', 'conditional_access')) {
    return {
      title: 'Your organization does not allow Mail Chat on this device or network',
      hint: 'A security rule blocked this sign-in. Try your usual work device or network, or ask your IT team and send them the details below.'
    };
  }
  if (has('700016', '650052', '50105', '700020')) {
    return {
      title: 'Mail Chat is not available for your organization yet',
      hint: 'Ask your IT admin to add Mail Chat for your organization and send them the details below.'
    };
  }
  if (has('50020') || /(personal|consumer|work or school|organizational)[^.]{0,60}(not (supported|allowed)|cannot|can't|only)/i.test(facts.message)) {
    return {
      title: 'This account does not match the button you used',
      hint: `Try the ${other} account button instead.`
    };
  }
  if (has('50011', '9002331', '70002', '70001', '70011', '50194', '700025', '7000218', '7000215', '900144') || says('invalid_client', 'unauthorized_client', 'invalid_scope', 'redirect_uri')) {
    return {
      title: 'Mail Chat is not set up correctly',
      hint: 'This is a problem with the app, not with you. Contact the developer and send them the details below.'
    };
  }
  if (says('enotfound', 'econnrefused', 'etimedout', 'econnreset', 'eai_again', 'enetunreach', 'getaddrinfo', 'network_error', 'no_network_connectivity', 'net::err', 'socket hang up', 'request timed out', 'fetch failed')) {
    return { title: 'Could not reach Microsoft', hint: 'Check your internet connection, VPN or proxy, then try again.' };
  }
  return undefined;
}

export function explainAuthError(error: unknown, kind: AccountKind, flow: Flow = 'browser'): AuthErrorInfo {
  const facts = factsOf(error);
  const found = classify(facts, kind);
  const picked =
    found ??
    (flow === 'silent'
      ? { title: 'Your sign-in expired', hint: 'Press the button to sign in again.' }
      : {
          title: 'Sign-in did not work',
          hint: 'Try again, or try the other account button. If it keeps happening, send the details below to your IT team or the app developer.'
        });
  const needsAdmin = kind === 'work' && /^(Your organization needs to approve|Mail Chat is not available)/.test(picked.title);
  const adminLink = needsAdmin ? adminConsentUrl() : undefined;
  const details = detailsOf(facts, picked.title, kind, flow) + (adminLink ? `
Admin approval link (one click for an admin): ${adminLink}` : '');
  return { title: picked.title, hint: picked.hint, code: facts.codes[0], details, adminLink };
}

function scopesFor(kind: AccountKind): string[] {
  return kind === 'personal' ? PERSONAL_SCOPES : WORK_SCOPES;
}

function signedInState(account: AccountInfo): AuthState {
  return { signedIn: true, busy: false, account: personOf(account), accountKind: kindOf(account) };
}

function personOf(account: AccountInfo) {
  return { name: account.name || account.username, email: account.username };
}

function isInteractionRequired(error: unknown): boolean {
  if (error instanceof InteractionRequiredAuthError) return true;
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === 'string' && INTERACTION_CODES.has(code);
}

function describe(error: unknown): string {
  const record = error as { errorMessage?: unknown; message?: unknown } | null;
  const text = typeof record?.errorMessage === 'string' && record.errorMessage ? record.errorMessage : error instanceof Error ? error.message : String(error);
  return text.split(/\r?\n/)[0].trim();
}
