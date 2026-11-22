import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type MailChatApi } from '../shared/ipc';
import type { AppEvent } from '../shared/types';

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: MailChatApi = {
  snapshot: () => invoke(IPC.snapshot),
  signIn: (kind) => invoke(IPC.signIn, kind),
  signInWithCode: (kind) => invoke(IPC.signInWithCode, kind),
  cancelSignIn: () => invoke(IPC.cancelSignIn),
  orgGet: () => invoke(IPC.orgGet),
  orgSet: (email, clientId) => invoke(IPC.orgSet, email, clientId),
  signOut: () => invoke(IPC.signOut),
  refresh: () => invoke(IPC.refresh),
  thread: (threadId) => invoke(IPC.thread, threadId),
  markRead: (threadId) => invoke(IPC.markRead, threadId),
  markUnread: (threadId) => invoke(IPC.markUnread, threadId),
  setPinned: (threadId, pinned) => invoke(IPC.setPinned, threadId, pinned),
  setMuted: (threadId, muted) => invoke(IPC.setMuted, threadId, muted),
  setArchived: (threadId, archived) => invoke(IPC.setArchived, threadId, archived),
  attachments: (messageId) => invoke(IPC.attachments, messageId),
  inlineImages: (messageId) => invoke(IPC.inlineImages, messageId),
  openAttachment: (messageId, attachmentId, name) => invoke(IPC.openAttachment, messageId, attachmentId, name),
  saveAttachment: (messageId, attachmentId, name) => invoke(IPC.saveAttachment, messageId, attachmentId, name),
  sendReply: (request) => invoke(IPC.sendReply, request),
  sendNew: (request) => invoke(IPC.sendNew, request),
  searchPeople: (query) => invoke(IPC.searchPeople, query),
  photo: (email) => invoke(IPC.photo, email),
  pickFiles: () => invoke(IPC.pickFiles),
  describeFiles: (paths) => invoke(IPC.describeFiles, paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openExternal: (url) => invoke(IPC.openExternal, url),
  saveSettings: (settings) => invoke(IPC.saveSettings, settings),
  ai: (request) => invoke(IPC.ai, request),
  aiStatus: () => invoke(IPC.aiStatus),
  setGroupSilent: (groupId, silent) => invoke(IPC.setGroupSilent, groupId, silent),
  moveToGroup: (threadId, groupId) => invoke(IPC.moveToGroup, threadId, groupId),
  createGroup: (name) => invoke(IPC.createGroup, name),
  outlookSignatures: () => invoke(IPC.outlookSignatures),
  importOutlookSignature: (name) => invoke(IPC.importOutlookSignature, name),
  pickImage: () => invoke(IPC.pickImage),
  setUnreadBadge: (count) => ipcRenderer.send(IPC.setUnreadBadge, count),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AppEvent) => listener(payload);
    ipcRenderer.on(IPC.event, handler);
    return () => ipcRenderer.removeListener(IPC.event, handler);
  }
};

contextBridge.exposeInMainWorld('mailChat', api);
