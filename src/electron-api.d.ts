import type { InvokeChannels, EventChannels } from '@shared/ipcChannels';

declare global {
  interface Window {
    electron: {
      invoke<C extends keyof InvokeChannels>(
        channel: C,
        ...args: InvokeChannels[C]['args']
      ): Promise<InvokeChannels[C]['result']>;
      on<C extends keyof EventChannels>(
        channel: C,
        callback: (payload: EventChannels[C]) => void,
      ): () => void;
    };
  }
}

export {};
