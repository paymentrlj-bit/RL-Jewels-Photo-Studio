// Bulk review. Everything the AI passed its own QA sits here waiting for a
// human, alongside everything that failed and needs a reshoot.
//
// v1 reviewed one product at a time in a wizard step. Reviewing 40 items a day
// that way is 40 separate passes through a four-step flow; here it is one
// screen you work down.

import React, { useCallback, useMemo, useState } from 'react';
import {
  CheckCircle2, XCircle, RefreshCw, AlertTriangle, Sparkles, ChevronDown, ChevronUp, Wand2, Image as ImageIcon, Trash2,
} from 'lucide-react';
import { api, ApiError } from '../api';
import { AngleCaptureButton } from '../components/AngleCaptureButton';
import { FixPanel } from '../components/FixPanel';
import type { Product } from '../types';
import { AUDIT_CHECK_LABELS, AUDIT_CHECK_FAILURE_LABELS, STATUS_LABELS } from '../types';

interface ReviewViewProps {
  products: Product[];
  onChanged: () => void;
}

// What staff actually need to know is "what's wrong", in their own words -
// not the AI's paragraph of reasoning ("Bead count mismatch: original had
// 14 gold balls (7 per side), enhanced image has 16 gold balls (8 per
// side)."). Where a checklist exists, this turns the failed checks into the
// same short phrases used everywhere else in the app (AUDIT_CHECK_LABELS),
// and keeps the AI's full sentence as an optional "Details" underneath
// rather than the headline.
function plainSummary(product: Product): string | null {
  const failed = Object.entries(product.auditChecklist || {}).filter(([, passed]) => !passed);
  if (failed.length === 0) return null;
  return failed.map(([key]) => AUDIT_CHECK_FAILURE_LABELS[key] || AUDIT_CHECK_LABELS[key] || key).join(', ');
}

export const ReviewView: React.FC<ReviewViewProps> = ({ products, onChanged }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

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
  const problems = products.filter((p) => p.status === 'needs_reshoot' || p.status === 'needs_angle' || p.status === 'failed');
  // Everything on this screen that is not a finished catalogue entry -
  // "pending" in the plainest sense. Approved and exported items are never
  // part of this list, so "Clear all" can never touch finished work.
  const pendingIds = useMemo(() => [...awaiting, ...problems].map((p) => p.id), [awaiting, problems]);

  const deleteOne = useCallback(async (id: string) => {
    if (!window.confirm('Delete this photo and its details for good? This cannot be undone.')) return;
    await act(id, () => api.deleteProduct(id));
  }, [act]);

  const clearAllPending = useCallback(async () => {
    if (pendingIds.length === 0) return;
    if (!window.confirm(
      `Delete all ${pendingIds.length} pending item${pendingIds.length === 1 ? '' : 's'} on this screen for good? This cannot be undone.`
    )) return;
    setClearingAll(true);
    setError(null);
    try {
      await api.bulkDeleteProducts(pendingIds);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not clear everything.');
    } finally {
      setClearingAll(false);
    }
  }, [pendingIds, onChanged]);

  return (
    <div className="space-y-8">
      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-red-800 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {pendingIds.length > 0 && (
        // A hard reset for a whole batch gone wrong - a bad lighting setup,
        // a wrong CPC used all morning - without deleting each item by hand.
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void clearAllPending()}
            disabled={clearingAll}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" /> {clearingAll ? 'Clearing…' : `Clear all pending (${pendingIds.length})`}
          </button>
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
                onDelete={() => void deleteOne(product.id)}
                onChanged={onChanged}
                onError={setError}
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
                onProceed={() => act(product.id, () => api.requeue(product.id, { proceedWithoutAngle: true }))}
                onDelete={() => void deleteOne(product.id)}
                onChanged={onChanged}
                onError={setError}
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
  onDelete: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}> = ({ product, busy, onApprove, onReject, onDelete, onChanged, onError }) => {
  const [showChecks, setShowChecks] = useState(false);
  const [mode, setMode] = useState<'idle' | 'rejecting' | 'fixing'>('idle');
  const [note, setNote] = useState('');
  const isFaithful = product.renderMode === 'faithful';

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
          <figcaption className={`px-2 py-1 text-center text-[11px] uppercase tracking-wide ${isFaithful ? 'text-emerald-700' : 'text-amber-700'}`}>
            {isFaithful ? 'Real photo, cut out' : 'Studio'}
          </figcaption>
        </figure>
      </div>

      <div className="flex-1 space-y-2 p-4">
        <p className="text-sm font-semibold text-stone-900">{product.name || product.itemType || 'Untitled'}</p>
        <p className="text-xs text-stone-500">
          {product.cpc || 'No CPC'} · {product.purity} · {product.netWeightGrams || '—'}g · {product.staffName}
        </p>

        {isFaithful && (
          // A cut-out skips the AI's own checks, so the reviewer is the check:
          // say plainly what they are looking at and why.
          <p className="flex items-start gap-1.5 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900">
            <ImageIcon className="mt-0.5 w-3 h-3 shrink-0" />
            <span>{product.auditReason || 'Your own photo, cut out onto white. Nothing in it was redrawn.'} Check the edges and that no tag is left.</span>
          </p>
        )}

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
            className="-my-2 flex min-h-[44px] items-center gap-1 py-2 text-xs text-stone-500 hover:text-stone-800"
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
        {mode === 'fixing' ? (
          <FixPanel
            product={product}
            onDone={onChanged}
            onCancel={() => setMode('idle')}
            onError={onError}
          />
        ) : mode === 'rejecting' ? (
          <div className="space-y-2">
            <label htmlFor={`note-${product.id}`} className="sr-only">Reason for reshoot</label>
            <input
              id={`note-${product.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What is wrong with it?"
              className="w-full min-h-[44px] rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onReject(note)}
                disabled={busy}
                className="min-h-[44px] flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                Send for reshoot
              </button>
              <button
                type="button"
                onClick={() => setMode('idle')}
                className="min-h-[44px] rounded-lg px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100"
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
              className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve
            </button>
            <button
              type="button"
              onClick={() => setMode('fixing')}
              disabled={busy}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            >
              <Wand2 className="w-4 h-4" /> Fix
            </button>
            <button
              type="button"
              onClick={() => setMode('rejecting')}
              disabled={busy}
              className="min-h-[44px] rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            >
              Reshoot
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              aria-label="Delete for good"
              title="Delete for good"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-stone-300 px-3 py-2 text-stone-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </article>
  );
};

const ProblemRow: React.FC<{
  product: Product;
  busy: boolean;
  onRequeue: () => void;
  onProceed: () => void;
  onDelete: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}> = ({ product, busy, onRequeue, onProceed, onDelete, onChanged, onError }) => {
  const [fixing, setFixing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const rawReason = product.auditReason || product.reviewNote || product.job?.lastError || 'No reason recorded.';
  const summary = plainSummary(product);
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-4">
        {product.originalPhotoId && (
          <img src={api.photoUrl(product.originalPhotoId)} alt="" className="h-16 w-16 rounded-lg object-cover bg-stone-100" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-stone-900">
            {product.cpc || product.itemType || 'Untitled'}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
              product.status === 'failed' ? 'bg-orange-100 text-orange-800'
              : product.status === 'needs_angle' ? 'bg-amber-100 text-amber-800'
              : 'bg-red-100 text-red-800'}`}>
              {STATUS_LABELS[product.status]}
            </span>
          </p>
          {/* The short version first - what's actually wrong, in the same
              plain words used everywhere else. The AI's full sentence is one
              tap away for anyone who wants it, not the first thing read. */}
          <p className="mt-0.5 text-xs text-stone-600">{summary || rawReason}</p>
          {summary && rawReason && (
            <button
              type="button"
              onClick={() => setShowDetails((s) => !s)}
              className="-ml-1 mt-0.5 flex min-h-[32px] items-center gap-0.5 px-1 text-xs text-stone-400 hover:text-stone-700"
            >
              {showDetails ? 'Hide details' : 'Show details'}
              {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
          {showDetails && summary && (
            <p className="mt-1 rounded-lg bg-stone-50 p-2 text-xs text-stone-500">{rawReason}</p>
          )}
          {product.status === 'failed' && (
            // The distinction matters: needs_reshoot means go and rephotograph
            // the piece; failed means the photo is fine and something went wrong
            // on our side, so retrying costs nothing but a moment.
            <p className="mt-1 text-xs text-stone-400">This was a processing error, not a problem with the photo. Retrying is usually enough.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {/* A failed audit is often a detail the first photo showed badly -
              another angle fixes that without redoing the whole shoot. */}
          {product.status !== 'failed' && (
            <AngleCaptureButton productId={product.id} onAdded={onChanged} onError={onError} />
          )}
          {/* Before a full reshoot: say what went wrong and have it redone,
              or use the real photo cut out. */}
          {product.status === 'needs_reshoot' && !fixing && (
            <button
              type="button"
              onClick={() => setFixing(true)}
              disabled={busy}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            >
              <Wand2 className="w-4 h-4" /> Fix
            </button>
          )}
          {product.status === 'needs_angle' ? (
            <button
              type="button"
              onClick={onProceed}
              disabled={busy}
              className="min-h-[44px] shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            >
              Process anyway
            </button>
          ) : (
            <button
              type="button"
              onClick={onRequeue}
              disabled={busy}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Retry
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            aria-label="Delete for good"
            title="Delete for good"
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border border-stone-300 px-3 py-2 text-stone-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {fixing && (
        <div className="mt-4 border-t border-stone-200 pt-4">
          <FixPanel product={product} onDone={onChanged} onCancel={() => setFixing(false)} onError={onError} />
        </div>
      )}
    </div>
  );
};
