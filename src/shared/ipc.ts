import type {
  AccountKind,
  AiRequest,
  AiResult,
  AppEvent,
  AppSnapshot,
  AttachmentInfo,
  NewThreadRequest,
  OutgoingAttachment,
  OutlookSignature,
  PickedImage,
  PersonSuggestion,
  SendReplyRequest,
  SendResult,
  Settings,
  ThreadDetail
} from './types';

export const IPC = {
  snapshot: 'mail:snapshot',
  signIn: 'auth:sign-in',
  signInWithCode: 'auth:sign-in-code',
  cancelSignIn: 'auth:cancel',
  signOut: 'auth:sign-out',
  refresh: 'mail:refresh',
  thread: 'mail:thread',
  markRead: 'mail:mark-read',
  markUnread: 'mail:mark-unread',
  setPinned: 'mail:set-pinned',
  setMuted: 'mail:set-muted',
  setArchived: 'mail:set-archived',
  attachments: 'mail:attachments',
  inlineImages: 'mail:inline-images',
  openAttachment: 'mail:open-attachment',
  saveAttachment: 'mail:save-attachment',
  sendReply: 'mail:send-reply',
  sendNew: 'mail:send-new',
  searchPeople: 'mail:search-people',
  photo: 'mail:photo',
  pickFiles: 'app:pick-files',
  describeFiles: 'app:describe-files',
  openExternal: 'app:open-external',
  saveSettings: 'app:save-settings',
  ai: 'ai:run',
  aiStatus: 'ai:status',
  setGroupSilent: 'mail:set-group-silent',
  moveToGroup: 'mail:move-to-group',
  createGroup: 'mail:create-group',
  outlookSignatures: 'sig:outlook-list',
  importOutlookSignature: 'sig:outlook-import',
  pickImage: 'sig:pick-image',
  event: 'app:event',
  setUnreadBadge: 'app:unread-badge'
} as const;

export interface AiStatus {
  available: boolean;
  path?: string;
  error?: string;
}

export interface MailChatApi {
  snapshot(): Promise<AppSnapshot>;
  signIn(kind: AccountKind): Promise<void>;
  signInWithCode(kind: AccountKind): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  thread(threadId: string): Promise<ThreadDetail>;
  markRead(threadId: string): Promise<void>;
  markUnread(threadId: string): Promise<void>;
  setPinned(threadId: string, pinned: boolean): Promise<void>;
  setMuted(threadId: string, muted: boolean): Promise<void>;
  setArchived(threadId: string, archived: boolean): Promise<void>;
  attachments(messageId: string): Promise<AttachmentInfo[]>;
  inlineImages(messageId: string): Promise<Record<string, string>>;
  openAttachment(messageId: string, attachmentId: string, name: string): Promise<void>;
  saveAttachment(messageId: string, attachmentId: string, name: string): Promise<void>;
  sendReply(request: SendReplyRequest): Promise<SendResult>;
  sendNew(request: NewThreadRequest): Promise<SendResult>;
  searchPeople(query: string): Promise<PersonSuggestion[]>;
  photo(email: string): Promise<string | null>;
  pickFiles(): Promise<OutgoingAttachment[]>;
  describeFiles(paths: string[]): Promise<OutgoingAttachment[]>;
  pathForFile(file: File): string;
  openExternal(url: string): Promise<void>;
  saveSettings(settings: Partial<Settings>): Promise<Settings>;
  ai(request: AiRequest): Promise<AiResult>;
  aiStatus(): Promise<AiStatus>;
  setGroupSilent(groupId: string, silent: boolean): Promise<void>;
  moveToGroup(threadId: string, groupId: string | null): Promise<void>;
  createGroup(name: string): Promise<string>;
  outlookSignatures(): Promise<OutlookSignature[]>;
  importOutlookSignature(name: string): Promise<string>;
  pickImage(): Promise<PickedImage | null>;
  setUnreadBadge(count: number): void;
  onEvent(listener: (event: AppEvent) => void): () => void;
}
