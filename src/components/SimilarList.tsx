// A row of look-alike pieces with photo, name and how close the match is. Used
// before shooting ("already shot?"), on cards ("similar pieces") and in Admin.
import React from 'react';
import { api, type SimilarMatch } from '../api';
import { STATUS_LABELS } from '../types';
import type { ProductStatus } from '../types';

export const tierLabel = (m: Pick<SimilarMatch, 'tier'>) => (m.tier === 'same' ? 'Very likely the same piece' : 'Looks similar');

export const SimilarList: React.FC<{ matches: SimilarMatch[] }> = ({ matches }) => (
  <ul className="grid gap-2 sm:grid-cols-2">
    {matches.map((m) => {
      const photoId = m.processedPhotoId || m.originalPhotoId;
      return (
        <li key={m.productId} className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-2">
          {photoId ? (
            <img src={api.photoUrl(photoId)} alt="" className="h-16 w-16 shrink-0 rounded-md bg-stone-100 object-contain" />
          ) : (
            <div className="h-16 w-16 shrink-0 rounded-md bg-stone-100" />
          )}
          <div className="min-w-0 text-xs">
            <p className="truncate text-sm font-medium text-stone-900">{m.name || m.itemType || 'Untitled'}</p>
            <p className="truncate text-stone-500">{m.cpc || 'No CPC'} · {STATUS_LABELS[m.status as ProductStatus] ?? m.status}</p>
            <p className={m.tier === 'same' ? 'font-medium text-amber-800' : 'text-stone-600'}>{tierLabel(m)} ({Math.round(m.score * 100)}%)</p>
          </div>
        </li>
      );
    })}
  </ul>
);

/** "Similar pieces" button + results, for any product card. */
export const SimilarPieces: React.FC<{ productId: string }> = ({ productId }) => {
  const [state, setState] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [matches, setMatches] = React.useState<SimilarMatch[]>([]);
  const [basis, setBasis] = React.useState<'studio' | 'original'>('studio');

  const load = async () => {
    setState('loading');
    try {
      const res = await api.similarTo(productId);
      setMatches(res.matches);
      setBasis(res.basis);
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="space-y-2">
      {state === 'idle' && (
        <button type="button" onClick={() => void load()} className="min-h-[44px] text-xs font-medium text-stone-600 underline hover:text-stone-900">
          Find similar pieces
        </button>
      )}
      {state === 'loading' && <p className="text-xs text-stone-500">Looking…</p>}
      {state === 'error' && <p className="text-xs text-red-700">Could not search just now.</p>}
      {state === 'done' && (
        matches.length === 0
          ? <p className="text-xs text-stone-500">Nothing similar found.</p>
          : (
            <>
              <SimilarList matches={matches} />
              {basis === 'original' && <p className="text-[11px] text-stone-400">Compared on counter photos - the studio photo is not ready yet, so this is rougher.</p>}
            </>
          )
      )}
    </div>
  );
};
