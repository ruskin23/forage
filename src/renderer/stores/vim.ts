import { create } from 'zustand';

type KeyMap = Record<string, () => void>;

type VimContext = {
  name: string;
  keyMap: KeyMap;
  hints: VimHint[];
};

type VimHint = {
  key: string;
  label: string;
};

type VimState = {
  mode: 'normal' | 'command';
  contextStack: VimContext[];
  pendingChord: string | null;

  pushContext: (ctx: VimContext) => void;
  popContext: () => void;
  setMode: (mode: 'normal' | 'command') => void;
  setPendingChord: (key: string | null) => void;
  dispatch: (key: string) => boolean;
};

export type { KeyMap, VimContext, VimHint };

export const useVimStore = create<VimState>((set, get) => ({
  mode: 'normal',
  contextStack: [],
  pendingChord: null,

  pushContext: (ctx) =>
    set((s) => ({ contextStack: [...s.contextStack, ctx] })),

  popContext: () =>
    set((s) => ({
      contextStack: s.contextStack.slice(0, -1),
    })),

  setMode: (mode) => set({ mode, pendingChord: null }),

  setPendingChord: (key) => set({ pendingChord: key }),

  dispatch: (key) => {
    const { contextStack, pendingChord, setPendingChord } = get();
    const top = contextStack[contextStack.length - 1];
    if (!top) return false;

    // Check chord completion first
    if (pendingChord) {
      const chord = pendingChord + key;
      const handler = top.keyMap[chord];
      setPendingChord(null);
      if (handler) {
        handler();
        return true;
      }
      // Chord didn't match — fall through to single-key lookup
    }

    const handler = top.keyMap[key];
    if (handler) {
      handler();
      return true;
    }

    // `key` isn't a binding on its own — but if it's the prefix of a multi-key
    // binding (e.g. 'g' for 'gg'), start a pending chord and consume it.
    const startsChord = Object.keys(top.keyMap).some((k) => k.length > 1 && k.startsWith(key));
    if (startsChord) {
      setPendingChord(key);
      return true;
    }

    return false;
  },
}));
