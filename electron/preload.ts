/**
 * Sandboxed preload. The only bridge between the renderer and the main process.
 * It exposes a single allowlisted invoke channel plus an event subscription
 * helper. No Node primitives, no raw ipcRenderer, no dynamic channel names.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { Channel, EventMap, IpcResult } from '../shared/types';
import { CHANNELS, EVENTS, EVENT_PREFIX, INVOKE_CHANNEL } from '../shared/channels';

type EventKey = keyof EventMap;

const allowedChannels = new Set<string>(CHANNELS);

const allowedEvents = new Set<string>(EVENTS);

async function invoke<T>(channel: Channel, ...args: unknown[]): Promise<IpcResult<T>> {
  if (!allowedChannels.has(channel)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: `Blocked unknown channel: ${channel}`,
        at: Date.now(),
      },
    };
  }
  try {
    return (await ipcRenderer.invoke(INVOKE_CHANNEL, channel, args)) as IpcResult<T>;
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : String(err),
        at: Date.now(),
      },
    };
  }
}

function on<K extends EventKey>(event: K, listener: (payload: EventMap[K]) => void): () => void {
  if (!allowedEvents.has(event)) return () => undefined;
  const wrapped = (_event: Electron.IpcRendererEvent, payload: EventMap[K]) => listener(payload);
  ipcRenderer.on(`${EVENT_PREFIX}${event}`, wrapped);
  return () => {
    ipcRenderer.removeListener(`${EVENT_PREFIX}${event}`, wrapped);
  };
}

const bridge = {
  invoke,
  on,
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
  },
};

contextBridge.exposeInMainWorld('luma', bridge);

export type LumaBridge = typeof bridge;
