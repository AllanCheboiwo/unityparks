"use client";

import { useMemo, useState } from "react";

/**
 * A month calendar that only lets the guest pick a valid break start day —
 * the UI layer of turnover enforcement (our API re-validates, and Apaleo's
 * restriction calendar enforces underneath).
 *
 * Which weekdays are valid depends on the break length: the stay must both
 * START and END on a turnover day (Friday or Monday). So a 3-night weekend
 * can only start on a Friday (Fri→Mon), a 4-night midweek only on a Monday
 * (Mon→Fri), and a 7-night week on either. Invalid days stay visible but
 * disabled — clicking one explains the rule instead of silently ignoring it.
 */

const FRIDAY = 5;
const MONDAY = 1;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Weekdays on which a break of this length may start. */
export function validArrivalDows(nights: number): number[] {
  return [MONDAY, FRIDAY].filter((dow) => {
    const departureDow = (dow + nights) % 7;
    return departureDow === MONDAY || departureDow === FRIDAY;
  });
}

function explainDisabled(dow: number, nights: number): string {
  const valid = validArrivalDows(nights);
  if (dow !== FRIDAY && dow !== MONDAY) {
    return `Breaks start on a Friday or Monday — ${DAY_NAMES[dow]} arrivals aren't available.`;
  }
  if (valid.length === 1 && valid[0] === FRIDAY) {
    return "A 3-night weekend break runs Friday to Monday — pick a Friday.";
  }
  return "A 4-night midweek break runs Monday to Friday — pick a Monday.";
}

type Props = {
  value: string | null;
  onChange: (iso: string) => void;
  nights: number;
  minDate: string; // ISO, inclusive
  maxDate: string; // ISO, inclusive
  /** Called when the guest clicks a day that can't start this break. */
  onDisabledPick?: (reason: string) => void;
};

export function TurnoverCalendar({
  value,
  onChange,
  nights,
  minDate,
  maxDate,
  onDisabledPick,
}: Props) {
  const initial = value ?? minDate;
  const [viewYear, setViewYear] = useState(Number(initial.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(Number(initial.slice(5, 7)) - 1);

  const validDows = useMemo(() => validArrivalDows(nights), [nights]);

  const weeks = useMemo(() => {
    const first = new Date(Date.UTC(viewYear, viewMonth, 1));
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const leadingBlanks = (first.getUTCDay() + 6) % 7; // Monday-first grid

    const cells: Array<{ iso: string; day: number; dow: number } | null> = [];
    for (let i = 0; i < leadingBlanks; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(Date.UTC(viewYear, viewMonth, day));
      cells.push({ iso: toIso(d), day, dow: d.getUTCDay() });
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [viewYear, viewMonth]);

  const monthStartIso = toIso(new Date(Date.UTC(viewYear, viewMonth, 1)));
  const monthEndIso = toIso(new Date(Date.UTC(viewYear, viewMonth + 1, 0)));
  const canGoBack = monthStartIso > minDate;
  const canGoForward = monthEndIso < maxDate;

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  }

  return (
    <div className="rounded-xl border border-forest/15 bg-white p-3 w-full max-w-xs select-none">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={!canGoBack}
          aria-label="Previous month"
          className="rounded-md px-2 py-1 text-forest hover:bg-sand disabled:opacity-25"
        >
          ←
        </button>
        <p className="text-sm font-semibold text-forest">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          disabled={!canGoForward}
          aria-label="Next month"
          className="rounded-md px-2 py-1 text-forest hover:bg-sand disabled:opacity-25"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] font-medium text-foreground/45 uppercase tracking-wide mb-1">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      {weeks.map((week, i) => (
        <div key={i} className="grid grid-cols-7 gap-y-0.5">
          {week.map((cell, j) => {
            if (!cell) return <span key={j} />;
            const inRange = cell.iso >= minDate && cell.iso <= maxDate;
            const validDay = validDows.includes(cell.dow);
            const pickable = inRange && validDay;
            const selected = value === cell.iso;
            return (
              <button
                key={j}
                type="button"
                onClick={() => {
                  if (pickable) onChange(cell.iso);
                  else if (inRange) onDisabledPick?.(explainDisabled(cell.dow, nights));
                }}
                className={
                  selected
                    ? "m-0.5 rounded-md bg-forest text-white text-sm py-1.5 font-semibold"
                    : pickable
                      ? "m-0.5 rounded-md text-sm py-1.5 font-semibold text-forest ring-1 ring-forest/25 hover:bg-forest hover:text-white transition-colors"
                      : "m-0.5 rounded-md text-sm py-1.5 text-foreground/25 cursor-not-allowed"
                }
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      ))}

      <p className="mt-2 text-[11px] text-foreground/50 text-center">
        {validDows.length === 2
          ? "Breaks start on Fridays and Mondays"
          : validDows[0] === FRIDAY
            ? "Weekend breaks start on a Friday"
            : "Midweek breaks start on a Monday"}
      </p>
    </div>
  );
}
