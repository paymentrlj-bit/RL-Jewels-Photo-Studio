// A text box that is also a list: tap it to scroll through every choice, or type
// and the list narrows to what matches. Used for the Share tab's category filter.
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

export interface ComboOption {
  value: string;
  /** Shown on the right, e.g. how many products. */
  hint?: string;
  /** Other words that should find this option ("har" finds Haar). */
  aliases?: string[];
}

export const ComboBox: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  label: string;
}> = ({ value, onChange, options, placeholder, label }) => {
  const [open, setOpen] = useState(false);
  // Until someone types, show everything: opening the box is how you browse.
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const shown = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!typed || !q) return options;
    return options.filter((o) => [o.value, ...(o.aliases ?? [])].some((name) => name.toLowerCase().includes(q)));
  }, [options, value, typed]);

  useEffect(() => setActive(0), [shown.length, open]);

  useEffect(() => {
    const away = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
    };
  }, []);

  const pick = (option: ComboOption) => {
    onChange(option.value);
    setTyped(false);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(e) => {
        // Tabbing out closes the list; clicking an option does not blur (see onMouseDown below).
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setOpen(true);
        }}
        onFocus={() => {
          setTyped(false);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        className="w-full rounded-xl border border-stone-300 bg-white py-3 pl-3 pr-16 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400"
      />
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
        {value && (
          <button type="button" aria-label={`Clear ${label}`} onClick={() => { onChange(''); setTyped(false); }} className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 hover:text-stone-700">
            <X className="h-4 w-4" />
          </button>
        )}
        <button type="button" tabIndex={-1} aria-label={open ? 'Close the list' : 'Show the list'} onClick={() => { setTyped(false); setOpen((o) => !o); }} className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 hover:text-stone-700">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-stone-500">Nothing matches - the list is filtered by what you typed.</li>}
          {shown.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value.toLowerCase() === value.trim().toLowerCase()}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3 text-sm ${i === active ? 'bg-amber-50' : ''}`}
            >
              <span className="text-stone-900">{o.value}</span>
              {o.hint && <span className="text-xs text-stone-400">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
