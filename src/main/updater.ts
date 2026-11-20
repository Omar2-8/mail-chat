import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

const SIX_HOURS = 6 * 60 * 60 * 1000;

// Updates only apply to the installed Windows build (Mac updates need a signed app). Dev runs and the portable exe cannot replace themselves.
export function startAutoUpdate(): void {
  if (process.platform !== 'win32' || !app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', () => undefined);
  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: `Mail Chat ${info.version} is ready.`,
        detail: 'Restart now to use it, or it installs the next time you close the app.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall();
      });
  });

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => undefined);
  };
  check();
  setInterval(check, SIX_HOURS).unref();
}
