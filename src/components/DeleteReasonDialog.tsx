// Asked before anything is deleted: why? One tap on a reason, and a few words
// only for "something else". The answer is what lets the owner see, later, whether
// pieces are being thrown away because of the AI picture, the counter photo or a
// slip at the keyboard.
import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DELETION_REASONS } from '../../server/catalog/deletionReasons';

export const DeleteReasonDialog: React.FC<{
  /** "this photo" / "all 12 pending items" */
  what: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, note: string) => void;
}> = ({ what, busy, onCancel, onConfirm }) => {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const chosen = DELETION_REASONS.find((r) => r.code === code);
  const ready = Boolean(chosen) && (!chosen?.needsNote || note.trim().length > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="delete-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="delete-title" className="font-semibold text-stone-900">Delete {what} for good?</h2>
        <p className="mt-1 text-sm text-stone-600">This cannot be undone. Why are you deleting it?</p>
        <div role="radiogroup" aria-label="Why are you deleting it" className="mt-3 space-y-2">
          {DELETION_REASONS.map((r) => (
            <label key={r.code} className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${code === r.code ? 'border-red-300 bg-red-50 text-stone-900' : 'border-stone-200 text-stone-700 hover:bg-stone-50'}`}>
              <input type="radio" name="delete-reason" value={r.code} checked={code === r.code} onChange={() => setCode(r.code)} className="h-4 w-4 accent-red-600" />
              {r.label}
            </label>
          ))}
        </div>
        {chosen && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder={chosen.needsNote ? 'Tell us in a few words' : 'Anything to add? (optional)'}
            aria-label="Anything to add"
            className="mt-3 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400"
          />
        )}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} className="min-h-[44px] flex-1 rounded-lg border border-stone-300 px-3 text-sm text-stone-700 hover:bg-stone-50">Keep it</button>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => onConfirm(code, note.trim())}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};
