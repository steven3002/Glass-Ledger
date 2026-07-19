"use client";

/**
 * A dropdown that belongs to this design system.
 *
 * The native <select> paints its own trigger and its own menu, and both read as browser chrome rather
 * than as the app. This one is the standard pattern instead: a bordered trigger with the value and a
 * chevron, opening a floating card of options — hover rows, a check on the current choice, closed by a
 * click elsewhere or Escape. No library; a listbox is not a hard thing to own.
 */

import { useEffect, useRef, useState } from "react";

export type DropdownOption<T extends string | number> = { value: T; label: string };

export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  prefix,
  align = "left",
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** A quiet word before the value — "Category", "Show". */
  prefix?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const chosen = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={root} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-lg border bg-surface px-3.5 py-2 text-[13px] transition-colors ${
          open ? "border-line-strong" : "border-line hover:border-line-strong"
        }`}
      >
        {prefix && <span className="font-medium text-mut">{prefix}</span>}
        <span className="font-semibold text-ink">{chosen?.label ?? String(value)}</span>
        <svg
          className={`size-3.5 text-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className={`absolute z-30 mt-1.5 min-w-full overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{ boxShadow: "0 4px 6px rgba(20,22,28,0.04), 0 12px 32px -12px rgba(20,22,28,0.18)" }}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <li key={String(option.value)} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-6 whitespace-nowrap rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                    selected ? "bg-sunken font-semibold text-ink" : "font-medium text-ink-2 hover:bg-sunken hover:text-ink"
                  }`}
                >
                  {option.label}
                  {selected && (
                    <svg className="size-3.5 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
