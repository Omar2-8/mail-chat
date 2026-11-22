import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, safeStorage, shell, Tray } from 'electron';
import { startAutoUpdate } from './updater';
import { loadOrg, saveOrg } from './org';
import { randomUUID } from 'crypto';
import { rmSync } from 'fs';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { IPC } from '../shared/ipc';
import type { AccountKind, AiRequest, AppEvent, AppSnapshot, NewThreadRequest, OutgoingAttachment, SendReplyRequest, Settings } from '../shared/types';
import { themeBackground, themeSource } from '../shared/themes';
import { Ai } from './ai';
import { Auth } from './auth';
import { Graph } from './graph';
import { MailService, messageOf, type IncomingNotice } from './mail';
import { listOutlookSignatures, readImage, readOutlookSignature } from './signature';
import { DEFAULT_PREFS, DEFAULT_SETTINGS, JsonFile, normalizeSettings, type ThreadPrefs } from './store';

const APP_ID = 'com.mailchat.app';
const APP_NAME = 'Mail Chat';
const HIDDEN_FLAG = '--hidden';

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
app.setName(APP_NAME);

function resource(name: string): string {
  return join(app.getAppPath(), 'resources', name);
}

function protect(plain: string): Buffer {
  return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain) : Buffer.from(plain, 'utf8');
}

function unprotect(data: Buffer): string {
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString('utf8');
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 150) || 'attachment';
}

function isSafeExternal(url: string): boolean {
  try {
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

class MailChatApp {
  private window: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private quitting = false;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private readonly settingsFile = new JsonFile<Settings>(join(app.getPath('userData'), 'settings.json'), DEFAULT_SETTINGS, undefined, (raw) => normalizeSettings(raw));
  private readonly prefsFile = new JsonFile<ThreadPrefs>(join(app.getPath('userData'), 'threads.json'), DEFAULT_PREFS);
  private auth!: Auth;
  private mail!: MailService;
  private ai!: Ai;
  private emitTimer?: ReturnType<typeof setTimeout>;
  private unread = 0;
  private readonly orgPath = join(app.getPath('userData'), 'org.json');

  async start(): Promise<void> {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    this.settings = await this.settingsFile.load();
    const prefs = await this.prefsFile.load();
    nativeTheme.themeSource = themeSource(this.settings.theme);
    this.auth = new Auth({
      cachePath: join(app.getPath('userData'), 'msal-cache.bin'),
      protect,
      unprotect,
      openBrowser: async (url) => {
        await shell.openExternal(url);
      }
    });
    this.auth.setOrg(await loadOrg(this.orgPath));
    const graph = new Graph(
      () => this.auth.token(),
      () => this.auth.state.accountKind === 'personal'
    );
    this.mail = new MailService(graph, this.prefsFile, prefs, () => this.settings, {
      changed: () => this.scheduleEmit(),
      threadChanged: (threadId) => this.send({ type: 'thread-updated', threadId }),
      incoming: (notices) => this.notify(notices),
      readFile: (path) => readFile(path)
    });
    this.ai = new Ai(() => this.settings, join(app.getPath('userData'), 'ai-work'));
    this.auth.onChange((state) => {
      if (state.signedIn) void this.mail.start();
      else if (!state.busy && !state.account) this.mail.stop();
      this.scheduleEmit();
    });
    this.registerIpc();
    this.createTray();
    this.createWindow(!process.argv.includes(HIDDEN_FLAG));
    await this.auth.init();
  }

  show(): void {
    const window = this.window ?? this.createWindow(false);
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  quit(): void {
    this.quitting = true;
    app.quit();
  }

  markQuitting(): void {
    this.quitting = true;
  }

  closesToTray(): boolean {
    return this.settings.closeToTray;
  }

  private snapshot(): AppSnapshot {
    return {
      auth: this.auth.state,
      sync: this.mail.sync,
      settings: this.settings,
      threads: this.auth.state.signedIn ? this.mail.threads() : [],
      groups: this.auth.state.signedIn ? this.mail.groups() : [],
      me: this.mail.me ?? this.auth.state.account
    };
  }

  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      this.send({ type: 'snapshot', snapshot: this.snapshot() });
    }, 80);
  }

  private send(event: AppEvent): void {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(IPC.event, event);
  }

  private notify(notices: IncomingNotice[]): void {
    if (this.window && !this.window.isFocused()) {
      if (process.platform === 'darwin') app.dock?.bounce();
      else this.window.flashFrame(true);
    }
    if (!this.settings.notifications || !Notification.isSupported()) return;
    const visible = notices.slice(-3);
    for (const notice of visible) {
      const notification = new Notification({
        title: notice.subject,
        body: `${notice.from.name}: ${notice.preview}`.slice(0, 240),
        icon: nativeImage.createFromPath(resource('icon.png'))
      });
      notification.on('click', () => {
        this.show();
        this.send({ type: 'open-thread', threadId: notice.threadId });
      });
      notification.show();
    }
  }

  private createWindow(showNow: boolean): BrowserWindow {
    const window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 760,
      minHeight: 520,
      show: false,
      title: APP_NAME,
      icon: resource('icon.png'),
      backgroundColor: themeBackground(this.settings.theme, nativeTheme.shouldUseDarkColors),
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true
      }
    });
    this.window = window;
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternal(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== window.webContents.getURL()) {
        event.preventDefault();
        if (isSafeExternal(url)) void shell.openExternal(url);
      }
    });
    window.on('focus', () => window.flashFrame(false));
    window.on('close', (event) => {
      if (!this.quitting && this.settings.closeToTray) {
        event.preventDefault();
        window.hide();
      }
    });
    window.on('closed', () => {
      if (this.window === window) this.window = null;
    });
    window.once('ready-to-show', () => {
      if (showNow) window.show();
    });
    const devUrl = process.env.MAIL_CHAT_DEV_URL;
    if (devUrl) void window.loadURL(devUrl);
    else void window.loadFile(join(__dirname, '../renderer/index.html'));
    return window;
  }

  private createTray(): void {
    this.tray = new Tray(nativeImage.createFromPath(resource('tray.png')).resize({ width: 18, height: 18 }));
    this.tray.setToolTip(APP_NAME);
    this.tray.on('click', () => this.show());
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Mail Chat', click: () => this.show() },
        { label: 'Refresh', click: () => void this.mail.refresh().catch(() => undefined) },
        { type: 'separator' },
        { label: 'Quit', click: () => this.quit() }
      ])
    );
  }

  private setUnread(count: number): void {
    if (count === this.unread) return;
    this.unread = count;
    const title = count > 0 ? `(${count}) ${APP_NAME}` : APP_NAME;
    this.window?.setTitle(title);
    this.tray?.setToolTip(count > 0 ? `${APP_NAME} · ${count} unread` : APP_NAME);
    if (process.platform === 'darwin') app.dock?.setBadge(count > 0 ? String(count) : '');
    else if (count > 0) this.window?.setOverlayIcon(nativeImage.createFromPath(resource('badge.png')), `${count} unread`);
    else this.window?.setOverlayIcon(null, '');
  }

  private async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const before = this.settings;
    this.settings = normalizeSettings({ ...this.settings, ...(patch && typeof patch === 'object' ? patch : {}) }, before);
    await this.settingsFile.save(this.settings);
    nativeTheme.themeSource = themeSource(this.settings.theme);
    if (before.theme !== this.settings.theme) this.window?.setBackgroundColor(themeBackground(this.settings.theme, nativeTheme.shouldUseDarkColors));
    if (before.startWithWindows !== this.settings.startWithWindows) {
      app.setLoginItemSettings({ openAtLogin: this.settings.startWithWindows, args: app.isPackaged ? [HIDDEN_FLAG] : [app.getAppPath(), HIDDEN_FLAG] });
    }
    if (before.claudePath !== this.settings.claudePath) this.ai.resetPath();
    if (before.historyDays !== this.settings.historyDays) void this.mail.refresh().catch(() => undefined);
    this.mail.rulesChanged();
    this.scheduleEmit();
    return this.settings;
  }

  private async describe(paths: string[]): Promise<OutgoingAttachment[]> {
    const files: OutgoingAttachment[] = [];
    for (const path of paths) {
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile()) files.push({ path, name: basename(path), size: info.size });
    }
    return files;
  }

  private async downloadAttachment(messageId: string, attachmentId: string, name: string): Promise<string> {
    const dir = join(app.getPath('temp'), 'mail-chat', randomUUID());
    await mkdir(dir, { recursive: true });
    const path = join(dir, safeName(name));
    await writeFile(path, await this.mail.attachmentBytes(messageId, attachmentId));
    return path;
  }

  private registerIpc(): void {
    const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) => {
      ipcMain.handle(channel, (_event, ...args) => fn(...(args as A)));
    };
    handle(IPC.snapshot, () => this.snapshot());
    handle(IPC.signIn, (kind: AccountKind) => {
      void this.auth.signIn(kind === 'personal' ? 'personal' : 'work');
    });
    handle(IPC.signInWithCode, (kind: AccountKind) => {
      void this.auth.signInWithCode(kind === 'personal' ? 'personal' : 'work');
    });
    handle(IPC.cancelSignIn, () => this.auth.cancel());
    handle(IPC.orgGet, () => loadOrg(this.orgPath));
    handle(IPC.orgSet, async (email: unknown, clientId: unknown) => {
      const result = await saveOrg(this.orgPath, email, clientId);
      if (result.ok) this.auth.setOrg(result.org);
      return result;
    });
    handle(IPC.signOut, async () => {
      await this.auth.signOut();
      this.mail.stop();
      this.scheduleEmit();
    });
    handle(IPC.refresh, () => this.mail.refresh());
    handle(IPC.thread, (threadId: string) => this.mail.thread(threadId));
    handle(IPC.markRead, (threadId: string) => this.mail.markRead(threadId));
    handle(IPC.markUnread, (threadId: string) => this.mail.markUnread(threadId));
    handle(IPC.setPinned, (threadId: string, on: boolean) => this.mail.setPinned(threadId, on));
    handle(IPC.setMuted, (threadId: string, on: boolean) => this.mail.setMuted(threadId, on));
    handle(IPC.setArchived, (threadId: string, on: boolean) => this.mail.setArchived(threadId, on));
    handle(IPC.attachments, (messageId: string) => this.mail.attachments(messageId));
    handle(IPC.inlineImages, (messageId: string, wanted: unknown) =>
      this.mail.inlineImages(messageId, Array.isArray(wanted) ? wanted.filter((id): id is string => typeof id === 'string').slice(0, 50) : [])
    );
    handle(IPC.openAttachment, async (messageId: string, attachmentId: string, name: string) => {
      const path = await this.downloadAttachment(messageId, attachmentId, name);
      const failure = await shell.openPath(path);
      if (failure) shell.showItemInFolder(path);
    });
    handle(IPC.saveAttachment, async (messageId: string, attachmentId: string, name: string) => {
      const owner = this.window ?? undefined;
      const options = { defaultPath: join(app.getPath('downloads'), safeName(name)) };
      const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return;
      await writeFile(result.filePath, await this.mail.attachmentBytes(messageId, attachmentId));
      shell.showItemInFolder(result.filePath);
    });
    handle(IPC.sendReply, (request: SendReplyRequest) => this.mail.sendReply(request));
    handle(IPC.sendNew, (request: NewThreadRequest) => this.mail.sendNew(request));
    handle(IPC.searchPeople, (query: string) => this.mail.searchPeople(query));
    handle(IPC.photo, (email: string) => this.mail.photo(email));
    handle(IPC.pickFiles, async () => {
      const owner = this.window ?? undefined;
      const options = { properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> };
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
      return result.canceled ? [] : this.describe(result.filePaths);
    });
    handle(IPC.describeFiles, (paths: string[]) => this.describe(paths));
    handle(IPC.openExternal, async (url: string) => {
      if (isSafeExternal(url)) await shell.openExternal(url);
    });
    handle(IPC.saveSettings, (patch: Partial<Settings>) => this.saveSettings(patch));
    handle(IPC.setGroupSilent, (groupId: string, silent: boolean) => this.mail.setGroupSilent(groupId, silent));
    handle(IPC.moveToGroup, (threadId: string, groupId: string | null) => this.mail.moveToGroup(threadId, groupId));
    handle(IPC.createGroup, (name: string) => this.mail.createGroup(name));
    handle(IPC.outlookSignatures, () => listOutlookSignatures());
    handle(IPC.importOutlookSignature, (name: string) => readOutlookSignature(name));
    handle(IPC.pickImage, async () => {
      const owner = this.window ?? undefined;
      const options = {
        properties: ['openFile'] as Array<'openFile'>,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }]
      };
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      return readImage(result.filePaths[0]);
    });
    handle(IPC.aiStatus, () => this.ai.status());
    handle(IPC.ai, async (request: AiRequest) => {
      if (!this.settings.aiEnabled) return { ok: false, error: 'AI helpers are turned off in Settings.' };
      try {
        await this.mail.thread(request.threadId);
        const transcript = this.mail.transcript(request.threadId, request.messageId);
        const me = this.mail.me;
        if (!transcript || !me) return { ok: false, error: 'Open the thread first.' };
        return await this.ai.run({ task: request.task, me, subject: transcript.subject, transcript: transcript.text, draft: request.draft });
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    });
    ipcMain.on(IPC.setUnreadBadge, (_event, count: number) => this.setUnread(Number(count) || 0));
  }
}

const instance = new MailChatApp();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => instance.show());
  app.on('before-quit', () => instance.markQuitting());
  app.on('window-all-closed', () => {
    if (!instance.closesToTray() && process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => instance.show());
  app.on('will-quit', () => {
    try {
      rmSync(join(app.getPath('temp'), 'mail-chat'), { recursive: true, force: true });
    } catch {
      return;
    }
  });
  app
    .whenReady()
    .then(() => {
      instance.start();
      startAutoUpdate();
    })
    .catch((error: unknown) => {
      dialog.showErrorBox(`${APP_NAME} could not start`, messageOf(error));
      app.exit(1);
    });
}
