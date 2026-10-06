// The last stop before a photo is sent for processing: tick what is true, per kind
// of piece. Every re-run costs a picture, so this is where they are prevented.
import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { shootChecklistFor } from '../../server/catalog/shootChecklist';

export const ShootCheckDialog: React.FC<{
  itemType: string;
  photo: string;
  extraPhotos: number;
  busy?: boolean;
  onConfirm: () => void;
  onBack: () => void;
}> = ({ itemType, photo, extraPhotos, busy, onConfirm, onBack }) => {
  const checklist = useMemo(() => shootChecklistFor(itemType), [itemType]);
  const [ticked, setTicked] = useState<string[]>([]);
  const all = checklist.items.every((i) => ticked.includes(i.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const toggle = (id: string) => setTicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="shoot-check-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="shoot-check-title" className="font-semibold text-stone-900">Check the photo - {checklist.title}</h2>
        <p className="mt-1 text-sm text-stone-600">
          A good photo means no re-runs. Look at the photo and tick each one that is true. If one is not, go back and fix it now.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <img src={photo} alt="The photo being sent" className="h-24 w-24 shrink-0 rounded-lg bg-stone-100 object-contain" />
          <p className="text-xs text-stone-500">
            {extraPhotos > 0 ? `${extraPhotos} extra photo${extraPhotos === 1 ? '' : 's'} added.` : 'No extra photos added.'}
          </p>
        </div>
        <ul className="mt-3 space-y-2">
          {checklist.items.map((item) => {
            const on = ticked.includes(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(item.id)}
                  className={`flex min-h-[44px] w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm ${on ? 'border-emerald-300 bg-emerald-50 text-stone-900' : 'border-stone-200 text-stone-700 hover:bg-stone-50'}`}
                >
                  {on ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-stone-300" />}
                  <span>{item.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onBack} className="min-h-[44px] flex-1 rounded-lg border border-stone-300 px-3 text-sm text-stone-700 hover:bg-stone-50">Go back</button>
          <button
            type="button"
            disabled={!all || busy}
            onClick={onConfirm}
            className="min-h-[44px] flex-[2] rounded-lg bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:bg-stone-300"
          >
            {busy ? 'Saving…' : all ? 'Send for processing' : `Tick all ${checklist.items.length} to send`}
          </button>
        </div>
      </div>
    </div>
  );
};
