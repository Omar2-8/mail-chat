const GRAPH = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 4;
const SIMPLE_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
const UPLOAD_CHUNK = 3 * 1024 * 1024;

export const LIST_FIELDS = [
  'id',
  'conversationId',
  'subject',
  'bodyPreview',
  'from',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'sentDateTime',
  'isRead',
  'isDraft',
  'hasAttachments',
  'importance',
  'parentFolderId',
  'webLink',
  'inferenceClassification'
].join(',');

const DETAIL_FIELDS = `${LIST_FIELDS},uniqueBody,body`;

export interface GraphAddress {
  emailAddress?: { name?: string | null; address?: string | null } | null;
}

export interface GraphBody {
  contentType?: string;
  content?: string;
}

export interface GraphMessage {
  '@odata.type'?: string;
  id: string;
  conversationId: string;
  subject?: string | null;
  bodyPreview?: string | null;
  from?: GraphAddress | null;
  toRecipients?: GraphAddress[] | null;
  ccRecipients?: GraphAddress[] | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  isRead?: boolean;
  isDraft?: boolean;
  hasAttachments?: boolean;
  importance?: string | null;
  parentFolderId?: string | null;
  webLink?: string | null;
  inferenceClassification?: string | null;
  uniqueBody?: GraphBody | null;
  body?: GraphBody | null;
}

export interface GraphAttachment {
  '@odata.type'?: string;
  id: string;
  name?: string | null;
  size?: number;
  contentType?: string | null;
  isInline?: boolean;
  contentId?: string | null;
  contentBytes?: string | null;
}

export interface GraphFolder {
  id: string;
  displayName?: string | null;
  parentFolderId?: string | null;
  childFolderCount?: number;
  totalItemCount?: number;
  unreadItemCount?: number;
  path?: string;
}

export interface GraphMe {
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  proxyAddresses?: string[] | null;
}

interface Page<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export interface DraftMessage {
  subject?: string;
  body?: { contentType: 'HTML' | 'Text'; content: string };
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
}

export interface UploadFile {
  name: string;
  size: number;
  read: () => Promise<Buffer>;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  raw?: boolean;
}

function isDeniedError(error: unknown): boolean {
  return error instanceof GraphError && (error.status === 401 || error.status === 403);
}

export class Graph {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly personal: () => boolean = () => false
  ) {}

  me(): Promise<GraphMe> {
    return this.json<GraphMe>('GET', '/me?$select=displayName,mail,userPrincipalName');
  }

  async proxyAddresses(): Promise<string[]> {
    const me = await this.json<GraphMe>('GET', '/me?$select=proxyAddresses').catch(() => undefined);
    return (me?.proxyAddresses ?? []).map((value) => value.replace(/^smtp:/i, ''));
  }

  async folderId(wellKnownName: string): Promise<string | undefined> {
    const folder = await this.json<{ id?: string }>('GET', `/me/mailFolders/${wellKnownName}?$select=id`).catch(() => undefined);
    return folder?.id;
  }

  async recentMessages(since: Date, maxMessages: number): Promise<GraphMessage[]> {
    const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
    const first = `/me/messages?$filter=${filter}&$orderby=receivedDateTime%20desc&$select=${LIST_FIELDS}&$top=100`;
    return this.collect<GraphMessage>(first, maxMessages);
  }

  async folderMessages(folderId: string, since: Date, maxMessages: number): Promise<GraphMessage[]> {
    const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
    const first = `/me/mailFolders/${enc(folderId)}/messages?$filter=${filter}&$orderby=receivedDateTime%20desc&$select=${LIST_FIELDS}&$top=100`;
    return this.collect<GraphMessage>(first, maxMessages);
  }

  async folders(): Promise<GraphFolder[]> {
    const result: GraphFolder[] = [];
    const walk = async (parentId: string, path: string, depth: number): Promise<void> => {
      const page = await this.json<Page<GraphFolder>>(
        'GET',
        `/me/mailFolders/${enc(parentId)}/childFolders?$top=200&$select=id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount`
      );
      for (const folder of page.value ?? []) {
        const full = path ? `${path} / ${folder.displayName ?? ''}` : folder.displayName ?? '';
        result.push({ ...folder, path: full });
        if ((folder.childFolderCount ?? 0) > 0 && depth < 3) await walk(folder.id, full, depth + 1);
      }
    };
    await walk('msgfolderroot', '', 0);
    return result;
  }

  createFolder(name: string): Promise<GraphFolder> {
    return this.json<GraphFolder>('POST', '/me/mailFolders', { body: { displayName: name } });
  }

  async conversation(conversationId: string, withBodies = true): Promise<GraphMessage[]> {
    const filter = encodeURIComponent(`conversationId eq '${conversationId.replace(/'/g, "''")}'`);
    const first = `/me/messages?$filter=${filter}&$select=${withBodies ? DETAIL_FIELDS : LIST_FIELDS}&$top=50`;
    return this.collect<GraphMessage>(first, 500, { Prefer: 'outlook.body-content-type="html"' });
  }

  async message(messageId: string): Promise<GraphMessage> {
    return this.json<GraphMessage>('GET', `/me/messages/${enc(messageId)}?$select=${DETAIL_FIELDS}`, {
      headers: { Prefer: 'outlook.body-content-type="html"' }
    });
  }

  async patchMessage(messageId: string, patch: Record<string, unknown>): Promise<void> {
    await this.request('PATCH', `/me/messages/${enc(messageId)}`, { body: patch });
  }

  async batchPatch(ids: string[], patch: Record<string, unknown>): Promise<void> {
    for (let start = 0; start < ids.length; start += 20) {
      const requests = ids.slice(start, start + 20).map((id, index) => ({
        id: String(index + 1),
        method: 'PATCH',
        url: `/me/messages/${enc(id)}`,
        headers: { 'Content-Type': 'application/json' },
        body: patch
      }));
      await this.request('POST', '/$batch', { body: { requests } });
    }
  }

  async uniqueBodies(ids: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (let start = 0; start < ids.length; start += 20) {
      const slice = ids.slice(start, start + 20);
      const requests = slice.map((id, index) => ({
        id: String(index),
        method: 'GET',
        url: `/me/messages/${enc(id)}?$select=uniqueBody`,
        headers: { Prefer: 'outlook.body-content-type="text"' }
      }));
      const reply = await this.json<{ responses?: { id: string; status: number; body?: { uniqueBody?: GraphBody } }[] }>('POST', '/$batch', { body: { requests } });
      for (const response of reply.responses ?? []) {
        const id = slice[Number(response.id)];
        if (id && response.status === 200) result.set(id, response.body?.uniqueBody?.content ?? '');
      }
    }
    return result;
  }

  async move(messageId: string, destinationId: string): Promise<void> {
    await this.request('POST', `/me/messages/${enc(messageId)}/move`, { body: { destinationId } });
  }

  async attachments(messageId: string): Promise<GraphAttachment[]> {
    const page = await this.json<Page<GraphAttachment>>(
      'GET',
      `/me/messages/${enc(messageId)}/attachments?$select=id,name,size,contentType,isInline,contentId`
    );
    return page.value ?? [];
  }

  attachment(messageId: string, attachmentId: string): Promise<GraphAttachment> {
    return this.json<GraphAttachment>('GET', `/me/messages/${enc(messageId)}/attachments/${enc(attachmentId)}`);
  }

  async attachmentBytes(messageId: string, attachmentId: string): Promise<Buffer> {
    const response = await this.request('GET', `/me/messages/${enc(messageId)}/attachments/${enc(attachmentId)}/$value`, { raw: true });
    return Buffer.from(await response.arrayBuffer());
  }

  createReply(messageId: string, all: boolean): Promise<GraphMessage> {
    return this.json<GraphMessage>('POST', `/me/messages/${enc(messageId)}/${all ? 'createReplyAll' : 'createReply'}`, {
      body: {},
      headers: { Prefer: 'outlook.body-content-type="html"' }
    });
  }

  createDraft(message: DraftMessage): Promise<GraphMessage> {
    return this.json<GraphMessage>('POST', '/me/messages', { body: message });
  }

  async addAttachment(messageId: string, file: UploadFile): Promise<void> {
    if (file.size <= SIMPLE_ATTACHMENT_LIMIT) {
      const bytes = await file.read();
      await this.request('POST', `/me/messages/${enc(messageId)}/attachments`, {
        body: { '@odata.type': '#microsoft.graph.fileAttachment', name: file.name, contentBytes: bytes.toString('base64') }
      });
      return;
    }
    const session = await this.json<{ uploadUrl: string }>('POST', `/me/messages/${enc(messageId)}/attachments/createUploadSession`, {
      body: { AttachmentItem: { attachmentType: 'file', name: file.name, size: file.size } }
    });
    const bytes = await file.read();
    for (let start = 0; start < bytes.length; start += UPLOAD_CHUNK) {
      const end = Math.min(start + UPLOAD_CHUNK, bytes.length);
      const response = await fetchWithTimeout(session.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(end - start),
          'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}`
        },
        body: new Uint8Array(bytes.subarray(start, end))
      });
      if (!response.ok) throw await toGraphError(response);
    }
  }

  async addInlineImage(messageId: string, image: { name: string; contentType: string; contentId: string; bytes: Buffer }): Promise<void> {
    await this.request('POST', `/me/messages/${enc(messageId)}/attachments`, {
      body: {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: image.name,
        contentType: image.contentType,
        contentId: image.contentId,
        isInline: true,
        contentBytes: image.bytes.toString('base64')
      }
    });
  }

  async send(messageId: string): Promise<void> {
    await this.request('POST', `/me/messages/${enc(messageId)}/send`);
  }

  async people(query: string): Promise<{ displayName?: string | null; scoredEmailAddresses?: { address?: string | null }[] | null }[]> {
    if (this.personal()) return [];
    const search = encodeURIComponent(`"${query.replace(/"/g, '')}"`);
    try {
      const page = await this.json<Page<{ displayName?: string | null; scoredEmailAddresses?: { address?: string | null }[] | null }>>(
        'GET',
        `/me/people?$search=${search}&$top=10&$select=displayName,scoredEmailAddresses`
      );
      return page.value ?? [];
    } catch (error) {
      if (isDeniedError(error)) return [];
      throw error;
    }
  }

  async users(query: string): Promise<{ displayName?: string | null; mail?: string | null; userPrincipalName?: string | null }[]> {
    if (this.personal()) return [];
    const term = query.replace(/"/g, '');
    const search = encodeURIComponent(`"displayName:${term}" OR "mail:${term}"`);
    try {
      const page = await this.json<Page<{ displayName?: string | null; mail?: string | null; userPrincipalName?: string | null }>>(
        'GET',
        `/users?$search=${search}&$top=8&$select=displayName,mail,userPrincipalName`,
        { headers: { ConsistencyLevel: 'eventual' } }
      );
      return page.value ?? [];
    } catch (error) {
      if (isDeniedError(error)) return [];
      throw error;
    }
  }

  async photo(email: string): Promise<Buffer | null> {
    if (this.personal()) return null;
    try {
      const response = await this.request('GET', `/users/${enc(email)}/photos/64x64/$value`, { raw: true });
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof GraphError && error.status >= 400 && error.status < 500) return null;
      throw error;
    }
  }

  private async collect<T>(first: string, max: number, headers?: Record<string, string>): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = first;
    while (next && items.length < max) {
      const page: Page<T> = await this.json<Page<T>>('GET', next, { headers });
      items.push(...(page.value ?? []));
      next = page['@odata.nextLink'];
    }
    return items.slice(0, max);
  }

  private async json<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request(method, path, options);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private async request(method: Method, path: string, options: RequestOptions = {}): Promise<Response> {
    const url = path.startsWith('https://') ? path : `${GRAPH}${path}`;
    for (let attempt = 1; ; attempt++) {
      const token = await this.token();
      let response: Response;
      try {
        response = await fetchWithTimeout(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined
        });
      } catch (error) {
        if (attempt >= 3 || method !== 'GET') throw new GraphError(`Network error: ${(error as Error).message}`, 0, 'network');
        await sleep(1000 * attempt);
        continue;
      }
      if (response.ok) return response;
      if ((response.status === 429 || response.status === 503 || response.status === 504) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get('Retry-After')) || 2 * attempt;
        await sleep(Math.min(retryAfter, 30) * 1000);
        continue;
      }
      throw await toGraphError(response);
    }
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function toGraphError(response: Response): Promise<GraphError> {
  const text = await response.text().catch(() => '');
  let code: string | undefined;
  let message = text.slice(0, 300);
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    code = parsed.error?.code;
    message = parsed.error?.message ?? message;
  } catch {
    message = message || response.statusText;
  }
  return new GraphError(`${response.status} ${code ?? ''} ${message}`.replace(/\s+/g, ' ').trim(), response.status, code);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
