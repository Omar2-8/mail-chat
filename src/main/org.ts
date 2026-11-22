import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { OrgConfig, OrgResult } from '../shared/types';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

export const NO_ORG: OrgConfig = { clientId: '', tenant: '', email: '' };

export async function loadOrg(path: string): Promise<OrgConfig> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<OrgConfig>;
    const clientId = typeof raw.clientId === 'string' && GUID.test(raw.clientId.trim()) ? raw.clientId.trim() : '';
    if (!clientId) return { ...NO_ORG };
    const tenant = typeof raw.tenant === 'string' && raw.tenant.trim() ? raw.tenant.trim() : 'organizations';
    return { clientId, tenant, email: typeof raw.email === 'string' ? raw.email.trim() : '' };
  } catch {
    return { ...NO_ORG };
  }
}

// Microsoft publishes a public discovery document per domain. Its issuer holds the tenant ID, so the user never has to look it up.
async function lookupTenant(email: string): Promise<string> {
  const domain = (email.includes('@') ? email.split('@').pop() ?? '' : email).trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error('Enter your work email, like name@company.com.');
  let issuer = '';
  try {
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(domain)}/v2.0/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) });
    if (response.ok) issuer = String(((await response.json()) as { issuer?: unknown }).issuer ?? '');
  } catch {
    throw new Error('Could not reach Microsoft. Check your connection and try again.');
  }
  const tenant = /login\.microsoftonline\.com\/([0-9a-f-]{36})\//i.exec(issuer)?.[1];
  if (!tenant) throw new Error(`Microsoft does not know ${domain} as a work or school organization.`);
  if (tenant.toLowerCase() === CONSUMER_TENANT) throw new Error('That looks like a personal account. Use the personal sign-in button instead.');
  return tenant.toLowerCase();
}

export async function saveOrg(path: string, email: unknown, clientId: unknown): Promise<OrgResult> {
  const mail = typeof email === 'string' ? email.trim() : '';
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  if (!mail && !id) {
    await rm(path, { force: true });
    return { ok: true, org: { ...NO_ORG } };
  }
  if (!id) return { ok: false, error: 'Paste the client ID your IT team gave you.', org: await loadOrg(path) };
  if (!GUID.test(id)) return { ok: false, error: 'A client ID looks like 11111111-2222-3333-4444-555555555555. Copy it from your IT team or the Entra admin center.', org: await loadOrg(path) };
  let tenant = 'organizations';
  if (mail) {
    try {
      tenant = await lookupTenant(mail);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), org: await loadOrg(path) };
    }
  }
  const org: OrgConfig = { clientId: id.toLowerCase(), tenant, email: mail };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(org, null, 2), 'utf8');
  return { ok: true, org };
}
