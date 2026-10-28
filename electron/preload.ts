import { contextBridge, ipcRenderer } from 'electron';
import type { Command, DesktopAPI, SystemAction, UpdateAction, UpdateStatus } from '../shared/types.js';
const api: DesktopAPI = {
  state: () => ipcRenderer.invoke('caderno:state'),
  command: (command: Command) => ipcRenderer.invoke('caderno:command', command),
  system: (action: SystemAction, payload?: Record<string, string>) => ipcRenderer.invoke('caderno:system', action, payload),
  onChange: (callback: () => void) => { const listener = () => callback(); ipcRenderer.on('caderno:changed', listener); return () => ipcRenderer.removeListener('caderno:changed', listener); },
  update: (action: UpdateAction) => ipcRenderer.invoke('caderno:update', action),
  onUpdate: (callback: (status: UpdateStatus) => void) => { const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status); ipcRenderer.on('caderno:update-changed', listener); return () => ipcRenderer.removeListener('caderno:update-changed', listener); },
};
contextBridge.exposeInMainWorld('caderno', api);
