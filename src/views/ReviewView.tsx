// Bulk review. Everything the AI passed its own QA sits here waiting for a
// human, alongside everything that failed and needs a reshoot.
//
// v1 reviewed one product at a time in a wizard step. Reviewing 40 items a day
// that way is 40 separate passes through a four-step flow; here it is one
// screen you work down.

import React, { useCallback, useState } from 'react';
import {
  CheckCircle2, XCircle, RefreshCw, AlertTriangle, Sparkles, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api, ApiError } from '../api';
import type { Product } from '../types';
import { AUDIT_CHECK_LABELS, STATUS_LABELS } from '../types';

interface ReviewViewProps {
  products: Product[];
  onChanged: () => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({ products, onChanged }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That action failed.');
    } finally {
      setBusyId(null);
    }
  }, [onChanged]);

  const awaiting = products.filter((p) => p.status === 'awaiting_review');
  const problems = products.filter((p) => p.status === 'needs_reshoot' || p.status === 'failed');

  return (
    <div className="space-y-8">
      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-red-800 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      <section>
        <h2 className="mb-4 font-semibold text-stone-900">
          Ready to review {awaiting.length > 0 && <span className="text-stone-500 font-normal">({awaiting.length})</span>}
        </h2>
        {awaiting.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-500">
            Nothing waiting. Items appear here once the AI has finished with them and passed its own quality check.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {awaiting.map((product) => (
              <ReviewCard
                key={product.id}
                product={product}
                busy={busyId === product.id}
                onApprove={() => act(product.id, () => api.approve(product.id))}
                onReject={(note) => act(product.id, () => api.reject(product.id, note))}
              />
            ))}
          </div>
        )}
      </section>

      {problems.length > 0 && (
        <section>
          <h2 className="mb-4 font-semibold text-stone-900">
            Needs attention <span className="text-stone-500 font-normal">({problems.length})</span>
          </h2>
          <div className="space-y-3">
            {problems.map((product) => (
              <ProblemRow
                key={product.id}
                product={product}
                busy={busyId === product.id}
                onRequeue={() => act(product.id, () => api.requeue(product.id))}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

const ReviewCard: React.FC<{
  product: Product;
  busy: boolean;
  onApprove: () => void;
  onReject: (note: string) => void;
}> = ({ product, busy, onApprove, onReject }) => {
  const [showChecks, setShowChecks] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');

  const failedChecks = Object.entries(product.auditChecklist || {}).filter(([, passed]) => !passed);

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <div className="grid grid-cols-2 gap-px bg-stone-200">
        <figure className="bg-white">
          {product.originalPhotoId && (
            <img src={api.photoUrl(product.originalPhotoId)} alt="Original counter photo" className="aspect-square w-full object-contain bg-stone-50" />
          )}
          <figcaption className="px-2 py-1 text-center text-[11px] uppercase tracking-wide text-stone-500">Original</figcaption>
        </figure>
        <figure className="bg-white">
          {product.processedPhotoId && (
            <img src={api.photoUrl(product.processedPhotoId)} alt="Studio-finished photo" className="aspect-square w-full object-contain bg-stone-50" />
          )}
          <figcaption className="px-2 py-1 text-center text-[11px] uppercase tracking-wide text-amber-700">Studio</figcaption>
        </figure>
      </div>

      <div className="flex-1 space-y-2 p-4">
        <p className="text-sm font-semibold text-stone-900">{product.name || product.itemType || 'Untitled'}</p>
        <p className="text-xs text-stone-500">
          {product.cpc || 'No CPC'} · {product.purity} · {product.netWeightGrams || '—'}g · {product.staffName}
        </p>

        {product.description && (
          <p className="text-xs leading-relaxed text-stone-600 line-clamp-3">{product.description}</p>
        )}

        {!product.description && (
          // Copy is queued separately from the photo, so it can legitimately
          // still be on its way. Saying so beats an unexplained empty space.
          <p className="flex items-center gap-1.5 text-xs text-stone-400">
            <Sparkles className="w-3 h-3" /> Catalogue copy is still being written…
          </p>
        )}

        {product.auditChecklist && (
          <button
            type="button"
            onClick={() => setShowChecks((s) => !s)}
            className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800"
          >
            {failedChecks.length === 0 ? 'All quality checks passed' : `${failedChecks.length} check(s) flagged`}
            {showChecks ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}

        {showChecks && product.auditChecklist && (
          <ul className="space-y-1 rounded-lg bg-stone-50 p-2">
            {Object.entries(product.auditChecklist).map(([key, passed]) => (
              <li key={key} className="flex items-center gap-1.5 text-xs">
                {passed
                  ? <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                  : <XCircle className="w-3 h-3 text-red-500 shrink-0" />}
                <span className={passed ? 'text-stone-600' : 'text-red-700'}>
                  {AUDIT_CHECK_LABELS[key] || key}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-stone-200 p-3">
        {rejecting ? (
          <div className="space-y-2">
            <label htmlFor={`note-${product.id}`} className="sr-only">Reason for reshoot</label>
            <input
              id={`note-${product.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What is wrong with it?"
              className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onReject(note)}
                disabled={busy}
                className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                Send for reshoot
              </button>
              <button
                type="button"
                onClick={() => setRejecting(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve
            </button>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={busy}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            >
              Reshoot
            </button>
          </div>
        )}
      </div>
    </article>
  );
};

const ProblemRow: React.FC<{ product: Product; busy: boolean; onRequeue: () => void }> = ({ product, busy, onRequeue }) => (
  <div className="flex items-center gap-4 rounded-xl border border-stone-200 bg-white p-4">
    {product.originalPhotoId && (
      <img src={api.photoUrl(product.originalPhotoId)} alt="" className="h-16 w-16 rounded-lg object-cover bg-stone-100" />
    )}
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-stone-900">
        {product.cpc || product.itemType || 'Untitled'}
        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${product.status === 'failed' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}`}>
          {STATUS_LABELS[product.status]}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-stone-600">
        {product.auditReason || product.reviewNote || product.job?.lastError || 'No reason recorded.'}
      </p>
      {product.status === 'failed' && (
        // The distinction matters: needs_reshoot means go and rephotograph
        // the piece; failed means the photo is fine and something went wrong
        // on our side, so retrying costs nothing but a moment.
        <p className="mt-1 text-xs text-stone-400">This was a processing error, not a problem with the photo. Retrying is usually enough.</p>
      )}
    </div>
    <button
      type="button"
      onClick={onRequeue}
      disabled={busy}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
    >
      <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Retry
    </button>
  </div>
);
