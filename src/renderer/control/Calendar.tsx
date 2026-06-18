import { useState, useMemo } from 'react';

interface CalendarProps {
  selectedDate: string;
  onSelect: (date: string) => void;
  feedDates: Set<string>;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function Calendar({ selectedDate, onSelect, feedDates }: CalendarProps) {
  const parsed = useMemo(() => {
    const [y, m] = selectedDate.split('-').map(Number);
    return { year: y || new Date().getFullYear(), month: m || new Date().getMonth() + 1 };
  }, [selectedDate]);

  const [viewYear, setViewYear] = useState(parsed.year);
  const [viewMonth, setViewMonth] = useState(parsed.month);

  const today = useMemo(() => {
    const d = new Date();
    return fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }, []);

  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  // Monday-based: Mon=0 ... Sun=6
  const firstDow = (new Date(viewYear, viewMonth - 1, 1).getDay() + 6) % 7;

  const cells = useMemo(() => {
    const arr: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    return arr;
  }, [firstDow, daysInMonth]);

  const prevMonth = () => {
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1); }
    else setViewMonth((m) => m + 1);
  };

  return (
    <div className="font-mono text-xs select-none">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="text-text-muted hover:text-text-secondary px-1 text-sm">&lsaquo;</button>
        <span className="text-text-secondary text-[11px]">{MONTHS[viewMonth - 1]} {viewYear}</span>
        <button onClick={nextMonth} className="text-text-muted hover:text-text-secondary px-1 text-sm">&rsaquo;</button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-0.5">
        {DOW.map((d) => (
          <div
            key={d}
            className={`text-center text-[10px] ${
              d === 'Sa' || d === 'Su' ? 'text-text-muted/50' : 'text-text-muted'
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} />;

          const ds = fmtDate(viewYear, viewMonth, day);
          const highlighted = ds === selectedDate;
          const isToday = ds === today;
          const dow = new Date(viewYear, viewMonth - 1, day).getDay();
          const weekend = dow === 0 || dow === 6;
          const hasFeed = feedDates.has(ds);
          const future = ds > today;

          return (
            <button
              key={day}
              onClick={() => { if (!future) onSelect(ds); }}
              className={[
                'relative h-7 text-center transition-colors rounded-sm',
                highlighted ? 'bg-accent/20 text-accent' : '',
                !highlighted && isToday ? 'text-accent' : '',
                !highlighted && !isToday && weekend ? 'text-text-muted/40' : '',
                !highlighted && !isToday && !weekend
                  ? 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                  : '',
                future ? 'opacity-30 cursor-default' : 'cursor-pointer',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {day}
              {hasFeed && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted">
        <span className="flex items-center gap-1">
          <span className="w-1 h-1 rounded-full bg-accent inline-block" />
          fetched
        </span>
        <span className="opacity-40">Sa Su &mdash; no arXiv</span>
      </div>
    </div>
  );
}
