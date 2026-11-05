// Runs in the sandboxed preload context: exposes a small, explicit API to the page.
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../src/desktop/api';

const listen = <T>(channel: string, cb: (v: T) => void): (() => void) => {
  const h = (_e: unknown, v: T): void => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

const api: DesktopApi = {
  engine: {
    info: () => ipcRenderer.invoke('engine:info'),
    send: (cmd) => ipcRenderer.send('engine:send', cmd),
    onLines: (cb) => listen('engine:lines', cb),
    onExit: (cb) => listen('engine:exit', cb),
    kill: () => ipcRenderer.invoke('engine:kill'),
    pick: () => ipcRenderer.invoke('engine:pick'),
  },
  store: {
    read: (key) => ipcRenderer.invoke('store:read', key),
    write: (key, value) => ipcRenderer.invoke('store:write', key, value),
    remove: (key) => ipcRenderer.invoke('store:remove', key),
    list: (prefix) => ipcRenderer.invoke('store:list', prefix),
  },
  system: { info: () => ipcRenderer.invoke('system:info') },
  http: { get: (url) => ipcRenderer.invoke('http:get', url) },
  files: { openText: (opts) => ipcRenderer.invoke('files:openText', opts) },
  puzzles: {
    importLichess: (opts) => ipcRenderer.invoke('puzzles:importLichess', opts),
    onProgress: (cb) => listen('puzzles:progress', cb),
    cancel: () => ipcRenderer.send('puzzles:cancel'),
  },
  coach: {
    hasKey: () => ipcRenderer.invoke('coach:hasKey'),
    setKey: (key) => ipcRenderer.invoke('coach:setKey', key),
    clearKey: () => ipcRenderer.invoke('coach:clearKey'),
    ask: (req) => ipcRenderer.invoke('coach:ask', req),
  },
  openExternal: (url) => ipcRenderer.send('app:openExternal', url),
};

contextBridge.exposeInMainWorld('desktop', api);
