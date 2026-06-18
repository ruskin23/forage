import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { InvokeChannels } from '@shared/ipcChannels';

// Typed wrapper around ipcMain.handle. Channel name and handler signature are
// checked against InvokeChannels — a typo or signature drift fails to compile.
export function handle<C extends keyof InvokeChannels>(
  channel: C,
  fn: (
    event: IpcMainInvokeEvent,
    ...args: InvokeChannels[C]['args']
  ) => Promise<InvokeChannels[C]['result']> | InvokeChannels[C]['result'],
): void {
  ipcMain.handle(channel, fn as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown);
}
