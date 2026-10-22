import type { Channel, EventMap, IpcResult } from '../shared/types';

declare global {
  interface Window {
    luma: {
      invoke<T>(channel: Channel, ...args: unknown[]): Promise<IpcResult<T>>;
      on<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): () => void;
      platform: string;
      versions: { electron: string; chrome: string };
    };
  }
}

export {};
