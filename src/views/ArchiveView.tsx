// The Archive: every product staff deleted. Staff are told a deleted product is
// gone; here the admin can see what was thrown away and why. A piece someone
// deleted is almost always a piece whose output was not good, so this is where
// the patterns show - which categories, which checks failed, who shot them.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, RotateCcw, Trash2, Search, AlertTriangle, X } from 'lucide-react';
import { api, ApiError, type ArchiveData, type ArchiveItem } from '../api';
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Not sent yet',
  queued: 'Waiting to process',
  processing: 'Processing',
  awaiting_review: 'Waiting for approval',
  needs_angle: 'Needed another angle',
  needs_reshoot: 'Sent back for retake',
  failed: 'Failed to process',
  approved: 'Approved',
  exported: 'Exported',
};

const dateText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

export const ArchiveView: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const [data, setData] = useState<ArchiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('');
  const [photographer, setPhotographer] = useState('');
  const [failedCheck, setFailedCheck] = useState('');
  const [search, setSearch] = useState('');
  const [viewer, setViewer] = useState<{ photos: ViewerPhoto[] } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.archive());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the archive.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (i) =>
        (!reason || i.reason === reason) &&
        (!category || i.category === category) &&
        (!photographer || i.staffName === photographer) &&
        (!failedCheck || i.failedChecks.some((c) => c.label === failedCheck)) &&
        (!q || `${i.cpc} ${i.name} ${i.itemType}`.toLowerCase().includes(q))
    );
  }, [data, reason, category, photographer, failedCheck, search]);

  const openPhotos = (item: ArchiveItem) => {
    const photos: ViewerPhoto[] = [];
    if (item.photos.original) photos.push({ label: 'Your photo', url: api.photoUrl(item.photos.original) });
    if (item.photos.processed) photos.push({ label: 'Studio photo', url: api.photoUrl(item.photos.processed) });
    if (item.photos.aiRender) photos.push({ label: 'AI version that failed its check', url: api.photoUrl(item.photos.aiRender) });
    if (item.photos.cutout) photos.push({ label: 'Real photo cut out', url: api.photoUrl(item.photos.cutout) });
    if (photos.length) setViewer({ photos });
  };

  const restore = async (item: ArchiveItem) => {
    try {
      await api.restoreArchived(item.id);
      setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== item.id) } : d));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not restore it.');
    }
  };

  const purge = async (item: ArchiveItem) => {
    try {
      await api.purgeArchived(item.id);
      setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== item.id) } : d));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete it.');
    }
  };

  const summary = data?.summary;
  const select = (value: string, set: (v: string) => void, label: string, options: { name: string; count: number }[]) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={label} className="min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400">
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o.name} value={o.name}>{o.name} ({o.count})</option>)}
    </select>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-stone-900"><Archive className="h-4 w-4" /> Archive - products staff deleted</p>
        <p className="mt-1 text-sm text-stone-600">
          Staff see these as deleted. They are kept here, with their photos, the reason they gave and the AI check results, because a piece that gets deleted is usually a piece whose picture was not good enough.
          Nothing here appears in Review, Share or Export. Keep this to yourselves - staff think deleted means gone.
        </p>
      </div>

      {error && <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
      {!data && !error && <p className="text-sm text-stone-500">Loading…</p>}

      {summary && summary.total > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Deleted so far" big={`${summary.total}`} note={summary.estimatedCostInr > 0 ? `about ₹${summary.estimatedCostInr.toLocaleString('en-IN')} of AI spend` : undefined} />
          <SummaryCard title="Why staff deleted them" rows={summary.byReason.slice(0, 5)} />
          <SummaryCard title="Most deleted categories" rows={summary.byCategory.slice(0, 4)} />
          <SummaryCard title="What the AI check flagged" rows={summary.byFailedCheck.slice(0, 4)} empty="Nothing flagged - they were deleted without a failed check." />
          <SummaryCard title="Deleted while" rows={summary.byStatus.slice(0, 4).map((r) => ({ ...r, name: STATUS_LABEL[r.name] ?? r.name }))} />
        </div>
      )}

      {summary && summary.total > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="CPC or name" aria-label="Search the archive" className="min-h-[44px] w-full rounded-xl border border-stone-300 bg-white py-2 pl-10 pr-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400" />
          </div>
          {select(reason, setReason, 'Reason', summary.byReason)}
          {select(category, setCategory, 'Category', summary.byCategory)}
          {select(photographer, setPhotographer, 'Shot by', summary.byPhotographer)}
          {select(failedCheck, setFailedCheck, 'AI flagged', summary.byFailedCheck)}
          {(reason || category || photographer || failedCheck || search) && (
            <button type="button" onClick={() => { setReason(''); setCategory(''); setPhotographer(''); setFailedCheck(''); setSearch(''); }} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-stone-300 px-4 text-sm text-stone-700 hover:bg-stone-50">
              <X className="h-4 w-4" /> Clear
            </button>
          )}
        </div>
      )}

      {summary && summary.total === 0 && (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-500">Nothing in the archive yet. Anything staff delete will appear here.</p>
      )}
      {summary && summary.total > 0 && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-500">No archived product matches these filters.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => <ArchiveCard key={item.id} item={item} canErase={isAdmin} onOpen={() => openPhotos(item)} onRestore={() => void restore(item)} onPurge={() => void purge(item)} />)}
      </div>

      {viewer && <PhotoViewer photos={viewer.photos} onClose={() => setViewer(null)} />}
    </div>
  );
};

const SummaryCard: React.FC<{ title: string; big?: string; note?: string; rows?: { name: string; count: number }[]; empty?: string }> = ({ title, big, note, rows, empty }) => (
  <div className="rounded-2xl border border-stone-200 bg-white p-4">
    <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{title}</p>
    {big && <p className="mt-1 text-3xl font-semibold text-stone-900">{big}</p>}
    {note && <p className="text-xs text-stone-500">{note}</p>}
    {rows && (rows.length === 0 ? (
      <p className="mt-2 text-sm text-stone-500">{empty ?? 'None'}</p>
    ) : (
      <ul className="mt-2 space-y-1 text-sm text-stone-700">
        {rows.map((r) => <li key={r.name} className="flex justify-between gap-3"><span>{r.name}</span><span className="text-stone-500">{r.count}</span></li>)}
      </ul>
    ))}
  </div>
);

const ArchiveCard: React.FC<{ item: ArchiveItem; canErase: boolean; onOpen: () => void; onRestore: () => void; onPurge: () => void }> = ({ item, canErase, onOpen, onRestore, onPurge }) => {
  const [confirming, setConfirming] = useState(false);
  const shown = [item.photos.original, item.photos.aiRender || item.photos.processed].filter((id): id is string => Boolean(id));
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white">
      {shown.length > 0 && (
        <button type="button" onClick={onOpen} aria-label="See the photos full size" className={`grid bg-stone-50 ${shown.length > 1 ? 'grid-cols-2' : ''}`}>
          {shown.map((id) => <img key={id} src={api.photoUrl(id)} alt="" loading="lazy" className="aspect-square w-full object-contain" />)}
        </button>
      )}
      <div className="flex-1 space-y-2 p-4 text-sm">
        <p className="font-semibold text-stone-900">{item.name || item.itemType || 'Untitled'}</p>
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">
          <span className="font-medium">{item.reason}</span>
          {item.reasonNote ? <span className="text-amber-800"> - {item.reasonNote}</span> : null}
        </p>
        <p className="text-xs text-stone-500">
          {item.cpc || 'No CPC'} · {item.category}{item.weightGrams !== null ? ` · ${item.weightGrams}g` : ''}
        </p>
        <p className="text-xs text-stone-500">
          Shot by {item.staffName} · deleted {dateText(item.archivedAt)}{item.archivedByName ? ` by ${item.archivedByName}` : ''}
        </p>
        <p className="text-xs text-stone-500">
          Deleted while: {STATUS_LABEL[item.statusWhenDeleted] ?? item.statusWhenDeleted}
          {item.riskScore !== null ? ` · risk ${item.riskScore}` : ''}
          {item.attemptCount > 0 ? ` · ${item.attemptCount} AI attempt${item.attemptCount === 1 ? '' : 's'}` : ''}
          {item.estimatedCostInr > 0 ? ` · ≈ ₹${item.estimatedCostInr.toFixed(0)} spent` : ''}
        </p>
        {item.failedChecks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.failedChecks.map((c) => <span key={c.check} className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-800">{c.label}</span>)}
          </div>
        )}
        {item.auditReason && <p className="text-xs text-stone-600">AI check: {item.auditReason}</p>}
        {item.reviewNote && <p className="text-xs text-stone-600">Note: {item.reviewNote}</p>}
      </div>
      <div className="flex gap-2 border-t border-stone-200 p-3">
        <button type="button" onClick={onRestore} className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-300 px-3 text-sm text-stone-700 hover:bg-stone-50">
          <RotateCcw className="h-4 w-4" /> Restore
        </button>
        {!canErase ? null : confirming ? (
          <button type="button" onClick={onPurge} className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700">
            <Trash2 className="h-4 w-4" /> Yes, erase it
          </button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-sm text-red-700 hover:bg-red-50">
            <Trash2 className="h-4 w-4" /> Delete forever
          </button>
        )}
      </div>
    </article>
  );
};
