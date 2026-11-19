import type { MailChatApi } from '../../shared/ipc';
import { createMockApi } from './mock';

declare global {
  interface Window {
    mailChat?: MailChatApi;
  }
}

export const isMock = !window.mailChat;
export const api: MailChatApi = window.mailChat ?? createMockApi();
