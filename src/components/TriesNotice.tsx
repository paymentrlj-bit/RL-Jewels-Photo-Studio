// Every AI picture is paid for, so a piece gets a few (the first and two re-runs).
// This shows how many it has used and, when they are gone, what to do instead:
// use the real photo cut out (free), or ask an admin to allow more.
import React, { useState } from 'react';
import { Image as ImageIcon, PlusCircle } from 'lucide-react';
import { api, ApiError } from '../api';
import { USE_REAL_PHOTO } from '../../server/catalog/fixes';
import type { Product } from '../types';

export const isOutOfTries = (p: Product) => (p.tries?.left ?? 1) <= 0;

export const TriesNotice: React.FC<{
  product: Product;
  isAdmin: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}> = ({ product, isAdmin, onChanged, onError }) => {
  const [busy, setBusy] = useState(false);
  const tries = product.tries;
  if (!tries || tries.used === 0) return null;

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusy(false);
    }
  };

  if (tries.left > 0) {
    return (
      <p className={`mb-2 text-xs ${tries.left === 1 ? 'font-medium text-amber-700' : 'text-stone-500'}`}>
        AI picture {tries.used} of {tries.max}{tries.left === 1 ? ' - the last try, so make it count' : ''}
      </p>
    );
  }

  return (
    <div className="mb-2 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="text-sm text-red-900">
        This piece has had {tries.used} AI pictures, so no more can be drawn. What you asked for has been written down.
        Use your real photo cut out onto white{isAdmin ? ', or allow more tries.' : ', or ask an admin to allow more tries.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => api.fix(product.id, { issues: [USE_REAL_PHOTO] }), 'Could not switch to the real photo.')}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-emerald-600 bg-white px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
        >
          <ImageIcon className="h-4 w-4" /> Use my real photo
        </button>
        {isAdmin && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => api.allowMoreTries(product.id), 'Could not allow more tries.')}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
          >
            <PlusCircle className="h-4 w-4" /> Allow 2 more tries
          </button>
        )}
      </div>
    </div>
  );
};
