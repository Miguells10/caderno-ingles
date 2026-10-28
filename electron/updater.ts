import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateAction, UpdateStatus } from '../shared/types.js';

const { autoUpdater } = electronUpdater;
const execFileAsync = promisify(execFile);

export function createUpdater(publish: (status: UpdateStatus) => void) {
  let status: UpdateStatus = { phase: 'idle', currentVersion: app.getVersion() };
  let pending: Promise<UpdateStatus> | null = null;
  const emit = (patch: Partial<UpdateStatus>) => {
    status = { ...status, ...patch };
    publish(status);
    return status;
  };
  const supported = () => app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE && existsSync(join(process.resourcesPath, 'app-update.yml'));

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', info => emit({ phase: 'available', availableVersion: info.version, progress: undefined, message: `Versão ${info.version} disponível.` }));
  autoUpdater.on('update-not-available', () => emit({ phase: 'current', availableVersion: undefined, progress: undefined, message: 'O Caderno está atualizado.' }));
  autoUpdater.on('download-progress', progress => emit({ phase: 'downloading', progress: Math.round(progress.percent), message: `Baixando atualização: ${Math.round(progress.percent)}%.` }));
  autoUpdater.on('update-downloaded', info => emit({ phase: 'ready', availableVersion: info.version, progress: 100, message: 'Atualização pronta. Reinicie para aplicar.' }));
  autoUpdater.on('error', () => emit({ phase: 'error', message: 'Não foi possível atualizar. Confira a conexão e sua sessão do GitHub.' }));

  async function token(): Promise<string | null> {
    const supplied = process.env.GH_TOKEN?.trim();
    if (supplied) return supplied;
    try {
      const result = await execFileAsync('gh', ['auth', 'token', '-h', 'github.com'], { timeout: 5000, windowsHide: true });
      return result.stdout.trim() || null;
    } catch { return null; }
  }

  async function check(): Promise<UpdateStatus> {
    if (!supported()) return emit({ phase: 'unsupported', message: 'Atualizações automáticas ficam disponíveis na versão instalada do Windows.' });
    if (pending) return pending;
    pending = (async () => {
      const accessToken = await token();
      if (!accessToken) return emit({ phase: 'login_required', message: 'Entre no GitHub neste computador para verificar atualizações privadas.' });
      process.env.GH_TOKEN = accessToken;
      autoUpdater.setFeedURL({ provider: 'github', owner: 'Miguells10', repo: 'caderno-ingles', private: true });
      emit({ phase: 'checking', message: 'Procurando atualização…' });
      try {
        await autoUpdater.checkForUpdates();
        return status;
      } catch {
        return emit({ phase: 'error', message: 'Não foi possível verificar atualizações. Confira a conexão e sua sessão do GitHub.' });
      }
    })().finally(() => { pending = null; });
    return pending;
  }

  async function act(action: UpdateAction): Promise<UpdateStatus> {
    if (action === 'status') return status;
    if (action === 'check') return check();
    if (action === 'download') {
      if (status.phase !== 'available') return status;
      emit({ phase: 'downloading', progress: 0, message: 'Iniciando download…' });
      try { await autoUpdater.downloadUpdate(); return status; }
      catch { return emit({ phase: 'error', message: 'Falha no download. Confira a conexão e tente novamente.' }); }
    }
    if (action === 'install' && status.phase === 'ready') autoUpdater.quitAndInstall(true, true);
    return status;
  }

  return { act, start: () => { void check(); } };
}
