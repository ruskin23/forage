import { useState, useRef, useEffect, useCallback } from 'react';
import { useVimStore } from '../stores/vim';

type VimBarProps = {
  onCommand: (command: string) => void;
  error?: string | null;
};

export function VimBar({ onCommand, error }: VimBarProps) {
  const mode = useVimStore((s) => s.mode);
  const setMode = useVimStore((s) => s.setMode);
  const contextStack = useVimStore((s) => s.contextStack);

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const active = mode === 'command';

  const close = useCallback(() => {
    setMode('normal');
    setInput('');
  }, [setMode]);

  const execute = useCallback(() => {
    const command = input.trim();
    if (command) onCommand(command);
    close();
  }, [input, onCommand, close]);

  // Focus input when command mode activates
  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  // Get hints from top context
  const topContext = contextStack[contextStack.length - 1];
  const hints = topContext?.hints ?? [];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 h-8 flex items-center bg-bg-base border-t border-divider px-3 font-mono text-sm">
      {active ? (
        <div className="flex items-center w-full">
          <span className="text-accent">:</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') execute();
              if (e.key === 'Escape') close();
            }}
            className="flex-1 bg-transparent text-text-primary outline-none ml-0.5"
            spellCheck={false}
          />
        </div>
      ) : error ? (
        <span className="text-dismiss">{error}</span>
      ) : (
        <div className="flex items-center gap-4">
          {hints.map(({ key, label }) => (
            <span key={key} className="text-text-muted">
              <span className="text-text-tertiary">{key}</span> {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
