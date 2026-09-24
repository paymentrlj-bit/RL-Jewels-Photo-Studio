// One-tap fix: staff tap what is wrong with a photo and it is redone with
// exactly that instruction - or cut out of the real photo instead ("Use my
// real photo"). Every tap is also remembered for the next piece of the same
// style (design memory, server/db/fixRequests.ts).

import React, { useMemo, useState } from 'react';
import { Wand2, Image as ImageIcon } from 'lucide-react';
import { api, ApiError } from '../api';
import { FIX_OPTIONS, USE_REAL_PHOTO } from '../../server/catalog/fixes';
import { resolveCategory } from '../../server/catalog/taxonomy';
import { logClientEvent } from '../utils/analytics';
import type { Product } from '../types';

interface FixPanelProps {
  product: Product;
  onDone: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

export const FixPanel: React.FC<FixPanelProps> = ({ product, onDone, onCancel, onError }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // "Black beads turned gold" only means something on a piece with black
  // beads; everywhere else it is noise on a small screen.
  const options = useMemo(() => {
    const hasBlackBeads =
      resolveCategory(product.itemType)?.type === 'Mangalsutra' || /\b(pote|pbb)\b/i.test(product.itemType);
    return FIX_OPTIONS.filter((o) => o.code !== 'black_beads' || hasBlackBeads);
  }, [product.itemType]);

  const useRealPhoto = selected.includes(USE_REAL_PHOTO);

  const toggle = (code: string) => {
    setSelected((current) => {
      // "Use my real photo" replaces the AI version outright, so it cannot be
      // combined with instructions for the AI.
      if (code === USE_REAL_PHOTO) return current.includes(code) ? [] : [code];
      const withoutReal = current.filter((c) => c !== USE_REAL_PHOTO);
      return withoutReal.includes(code) ? withoutReal.filter((c) => c !== code) : [...withoutReal, code];
    });
  };

  const submit = async () => {
    setBusy(true);
    try {
      await api.fix(product.id, { issues: selected, note: useRealPhoto ? '' : note });
      logClientEvent('fix_requested', { productId: product.id, issues: selected, hasNote: Boolean(note.trim()) });
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not send that fix.');
      setBusy(false);
    }
  };

  const canSubmit = !busy && (selected.length > 0 || note.trim().length > 0);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-stone-900">What's wrong with it?</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = selected.includes(option.code);
          return (
            <button
              key={option.code}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option.code)}
              className={`min-h-[44px] rounded-full border px-3 py-2 text-xs font-medium transition-colors ${
                on ? 'border-amber-600 bg-amber-600 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-pressed={useRealPhoto}
        onClick={() => toggle(USE_REAL_PHOTO)}
        className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
          useRealPhoto ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
        }`}
      >
        <ImageIcon className="w-4 h-4 shrink-0" />
        <span>
          <span className="font-medium">Use my real photo instead</span>
          <span className="block text-stone-500">Cut the piece out of the original onto white. Nothing redrawn.</span>
        </span>
      </button>

      {!useRealPhoto && (
        <>
          <label htmlFor={`fix-note-${product.id}`} className="sr-only">Anything else</label>
          <input
            id={`fix-note-${product.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Anything else? e.g. there are 7 drops, not 5"
            className="w-full min-h-[44px] rounded-lg border border-stone-300 px-3 py-2 text-xs"
          />
        </>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
        >
          <Wand2 className="w-4 h-4" /> {busy ? 'Sending…' : useRealPhoto ? 'Make the cut-out' : 'Redo it'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
