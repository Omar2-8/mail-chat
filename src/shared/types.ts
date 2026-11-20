export interface Person {
  name: string;
  email: string;
}

export type ThreadTag = 'fyi' | 'meeting' | 'important' | 'attachment' | 'external';

export type ThreadBox = 'focused' | 'other';

export interface ThreadSummary {
  id: string;
  subject: string;
  lastActivity: string;
  lastSender: Person;
  lastFromMe: boolean;
  preview: string;
  unreadCount: number;
  messageCount: number;
  participants: Person[];
  tags: ThreadTag[];
  box: ThreadBox;
  pinned: boolean;
  muted: boolean;
  silenced?: string;
  archived: boolean;
  groupId?: string;
  groupName?: string;
  webLink?: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  silent: boolean;
  threadCount: number;
  unreadThreads: number;
  lastActivity?: string;
  latestSubject?: string;
  latestSender?: string;
}

export type MessageKind = 'mail' | 'meeting' | 'forward';

export interface AttachmentInfo {
  id: string;
  name: string;
  size: number;
  contentType: string;
  isInline: boolean;
  contentId?: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  from: Person;
  fromMe: boolean;
  to: Person[];
  cc: Person[];
  sentAt: string;
  isRead: boolean;
  kind: MessageKind;
  subject: string;
  html: string;
  fullHtml: string;
  preview: string;
  hasAttachments: boolean;
  importance: 'low' | 'normal' | 'high';
  webLink?: string;
  historical?: boolean;
}

export interface ThreadDetail {
  id: string;
  subject: string;
  messages: ChatMessage[];
  participants: Person[];
}

export type ReplyMode = 'all' | 'sender';

export interface OutgoingAttachment {
  path: string;
  name: string;
  size: number;
}

export interface SendReplyRequest {
  threadId: string;
  text: string;
  mode: ReplyMode;
  replyToId?: string;
  attachments: OutgoingAttachment[];
}

export interface NewThreadRequest {
  to: Person[];
  cc: Person[];
  subject: string;
  text: string;
  attachments: OutgoingAttachment[];
}

export interface SendResult {
  ok: boolean;
  threadId?: string;
  error?: string;
}

export interface PendingDeviceLogin {
  userCode: string;
  verificationUri: string;
  expiresAt: string;
}

export type AccountKind = 'personal' | 'work';

export interface AuthErrorInfo {
  title: string;
  hint: string;
  code?: string;
  details: string;
  adminLink?: string;
}

export interface AuthState {
  signedIn: boolean;
  busy: boolean;
  account?: Person;
  accountKind?: AccountKind;
  device?: PendingDeviceLogin;
  error?: string;
  errorInfo?: AuthErrorInfo;
}

export type SyncPhase = 'idle' | 'loading' | 'syncing' | 'error' | 'offline';

export interface SyncState {
  phase: SyncPhase;
  lastSyncAt?: string;
  error?: string;
  historyDays: number;
}

export type SignatureMode = 'none' | 'simple' | 'html';

export type SignatureLayout = 'below' | 'left';

export interface Settings {
  historyDays: number;
  signature: string;
  signatureMode: SignatureMode;
  signatureHtml: string;
  signatureSource: string;
  signatureLogo: string;
  signatureLogoHeight: number;
  signatureLogoRatio: number;
  signatureLogoLink: string;
  signatureLayout: SignatureLayout;
  notifications: boolean;
  dndUntil: string;
  quietHours: boolean;
  quietFrom: string;
  quietTo: string;
  quietDays: number[];
  silenceOther: boolean;
  silenceFyi: boolean;
  silenceExternal: boolean;
  silenceMeetings: boolean;
  silenceAutomated: boolean;
  mutedSenders: string[];
  mutedKeywords: string[];
  vipSenders: string[];
  startWithWindows: boolean;
  closeToTray: boolean;
  aiEnabled: boolean;
  aiModel: string;
  claudePath: string;
  theme: ThemeName;
  defaultReplyMode: ReplyMode;
  chatTrim: boolean;
}

export type ThemeName = 'system' | 'light' | 'dark' | 'midnight' | 'ocean' | 'forest' | 'sunset';

export interface OutlookSignature {
  name: string;
  modified: string;
}

export interface PickedImage {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export interface AppSnapshot {
  auth: AuthState;
  sync: SyncState;
  settings: Settings;
  threads: ThreadSummary[];
  groups: GroupSummary[];
  me?: Person;
}

export type AiTask = 'tldr' | 'explain' | 'polish';

export interface AiRequest {
  task: AiTask;
  threadId: string;
  messageId?: string;
  draft?: string;
}

export interface AiResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface PersonSuggestion extends Person {
  source: 'people' | 'directory' | 'recent';
}

export type AppEvent =
  | { type: 'snapshot'; snapshot: AppSnapshot }
  | { type: 'thread-updated'; threadId: string }
  | { type: 'open-thread'; threadId: string };
