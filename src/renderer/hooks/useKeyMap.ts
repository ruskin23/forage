import { useEffect } from 'react';
import { useVimStore } from '../stores/vim';
import type { KeyMap, VimHint } from '../stores/vim';

export type { KeyMap };

export function useKeyMap(name: string, keyMap: KeyMap, hints: VimHint[] = []) {
  const pushContext = useVimStore((s) => s.pushContext);
  const popContext = useVimStore((s) => s.popContext);

  // Stable reference — callers must memoize keyMap via useMemo
  useEffect(() => {
    pushContext({ name, keyMap, hints });
    return () => popContext();
  }, [name, keyMap, hints, pushContext, popContext]);
}
