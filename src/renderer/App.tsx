import { useEffect, useCallback, useState } from 'react';
import { VimBar } from './components/VimBar';
import { Reader } from './reader/Reader';
import { ControlRoom } from './control/ControlRoom';
import { useUIStore } from './stores/ui';
import { useVimStore } from './stores/vim';

const zoneLabels = {
  reader: 'Reader',
  control: 'Control Room',
} as const;

// Command names are matched case-insensitively; several aliases per zone.
const commands: Record<string, 'reader' | 'control'> = {
  feed: 'reader',
  reader: 'reader',
  controlroom: 'control',
  control: 'control',
};

export function App() {
  const zone = useUIStore((s) => s.zone);
  const setZone = useUIStore((s) => s.setZone);
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const mode = useVimStore((s) => s.mode);
  const setMode = useVimStore((s) => s.setMode);
  const dispatch = useVimStore((s) => s.dispatch);
  const contextStack = useVimStore((s) => s.contextStack);
  const [commandError, setCommandError] = useState<string | null>(null);

  const handleCommand = useCallback((command: string) => {
    const target = commands[command.toLowerCase()];
    if (target) {
      setZone(target);
      setCommandError(null);
    } else {
      setCommandError(`not a command: ${command}`);
    }
  }, [setZone]);

  // Single global keydown listener — all vim keybinding routing
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // The Control Room is fully mouse-driven — it handles its own Escape and
      // has no vim context. Leave its keys alone.
      if (zone === 'control') return;

      const target = e.target instanceof HTMLElement ? e.target : null;
      const tag = target?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true;

      // Escape always works, even in inputs
      if (e.key === 'Escape') {
        e.preventDefault();

        // 1. Command mode → normal
        if (mode === 'command') {
          setMode('normal');
          return;
        }

        // 2. Modal open → close
        if (activeModal) {
          closeModal();
          return;
        }

        // 3. Context stack > 1 → pop (handled by dispatch since
        //    individual keymaps bind Escape if needed)
        // Let dispatch handle it
        dispatch('Escape');
        return;
      }

      // Don't capture keys when in inputs (except Escape above)
      if (isInput) return;

      // Command mode activation
      if (e.key === ':' && mode === 'normal') {
        e.preventDefault();
        setCommandError(null);
        setMode('command');
        return;
      }

      // Don't process keys in command mode (VimBar handles its own input)
      if (mode === 'command') return;

      // Route through vim dispatch
      const handled = dispatch(e.key);
      if (handled) e.preventDefault();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zone, mode, activeModal, setMode, closeModal, dispatch, contextStack]);

  return (
    <div className="noise relative min-h-screen pb-8">
      <header className="header-blur sticky top-0 z-40 h-10 flex items-center justify-between px-4 border-b border-divider">
        <span className="text-text-primary text-sm font-medium">Forage</span>
        <nav className="flex items-center gap-1 text-xs font-mono">
          {(Object.keys(zoneLabels) as (keyof typeof zoneLabels)[]).map((z) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              className={`px-2 py-1 rounded-sm transition-colors ${
                zone === z
                  ? 'text-accent bg-bg-elevated'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {zoneLabels[z]}
            </button>
          ))}
        </nav>
      </header>
      <div className="relative z-10">
        {zone === 'reader' && <Reader />}
        {zone === 'control' && <ControlRoom />}
      </div>
      {zone === 'reader' && <VimBar onCommand={handleCommand} error={commandError} />}
    </div>
  );
}
