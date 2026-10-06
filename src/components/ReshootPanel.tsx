// "Send for reshoot": one tap on what is wrong (the same problems as Fix, plus
// "my own photo was bad"), and a few words only if the chips do not say it. The
// reasons are counted, so the recurring ones - a wrong hook, a cut-off chain -
// can be fixed in the prompts instead of being found out one piece at a time.
import React, { useMemo, useState } from 'react';
import { FIX_OPTIONS, RESHOOT_ONLY_REASONS } from '../../server/catalog/fixes';
import { resolveCategory } from '../../server/catalog/taxonomy';

export const ReshootPanel: React.FC<{
  itemType: string;
  busy?: boolean;
  sendLabel?: string;
  onSend: (reasons: string[], note: string) => void;
  onCancel: () => void;
}> = ({ itemType, busy, sendLabel = 'Send for reshoot', onSend, onCancel }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const options = useMemo(() => {
    const hasBlackBeads = resolveCategory(itemType)?.type === 'Mangalsutra' || /\b(pote|pbb)\b/i.test(itemType);
    return [...FIX_OPTIONS.filter((o) => o.code !== 'black_beads' || hasBlackBeads), ...RESHOOT_ONLY_REASONS];
  }, [itemType]);

  const toggle = (code: string) => setSelected((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  const ready = selected.length > 0 || note.trim().length > 0;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-stone-900">Why does it need a reshoot?</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.code);
          return (
            <button
              key={o.code}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(o.code)}
              className={`min-h-[44px] rounded-full border px-3 py-2 text-xs font-medium transition-colors ${on ? 'border-red-600 bg-red-600 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        placeholder="Anything to add? (optional)"
        aria-label="Anything to add"
        className="w-full min-h-[44px] rounded-lg border border-stone-300 px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSend(selected, note.trim())}
          disabled={busy || !ready}
          className="min-h-[44px] flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {sendLabel}
        </button>
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded-lg px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100">Cancel</button>
      </div>
      {!ready && <p className="text-xs text-stone-500">Tap what is wrong, or write a few words.</p>}
    </div>
  );
};
