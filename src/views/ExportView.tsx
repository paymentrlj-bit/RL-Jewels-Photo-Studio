// Batch export. One CSV and one ZIP for a whole shoot, rather than v1's one
// file per product.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Archive, CloudUpload, Check, AlertTriangle, Loader2, FolderOpen } from 'lucide-react';
import { api, ApiError } from '../api';
import type { Batch } from '../types';

interface ExportViewProps {
  driveConfigured: boolean;
}

// How often to re-check progress on a Drive export in flight. Fast enough
// that staff aren't left staring at a stale number, cheap enough (one small
// GET) that polling it costs nothing real.
const DRIVE_POLL_MS = 1500;

interface DriveProgress {
  batchId: string;
  total: number;
  succeeded: number;
  inProgress: number;
  failed: number;
  alreadyExported: number;
  folderLink: string;
  failures: { cpc: string; error: string }[];
}

export const ExportView: React.FC<ExportViewProps> = ({ driveConfigured }) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [mappings, setMappings] = useState<{ id: string; label: string; description?: string; columnCount: number }[]>([]);
  const [mapping, setMapping] = useState('generic');
  const [uploading, setUploading] = useState<string | null>(null);
  const [progress, setProgress] = useState<DriveProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [batchData, mappingData] = await Promise.all([api.listBatches(), api.exportMappings()]);
      setBatches(batchData.batches);
      setMappings(mappingData.mappings);
      setMapping(mappingData.active);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load batches.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Stop polling if the component unmounts (or a new export starts) mid-run
  // - otherwise a stray timer keeps firing against a screen nobody's on.
  useEffect(() => () => { if (pollTimer.current) window.clearTimeout(pollTimer.current); }, []);

  const poll = useCallback(async (batchId: string, alreadyExportedAtStart: number) => {
    try {
      const status = await api.driveExportStatus(batchId);
      setProgress({
        batchId,
        total: status.total,
        succeeded: status.succeeded,
        inProgress: status.inProgress,
        failed: status.failed,
        alreadyExported: alreadyExportedAtStart,
        folderLink: status.folderLink,
        failures: status.failures,
      });
      if (status.inProgress > 0) {
        pollTimer.current = window.setTimeout(() => void poll(batchId, alreadyExportedAtStart), DRIVE_POLL_MS);
      } else {
        setUploading(null);
        await load();
      }
    } catch (err) {
      setUploading(null);
      setError(err instanceof ApiError ? err.message : 'Could not check Drive export progress.');
    }
  }, [load]);

  const handleDrive = useCallback(async (batchId: string) => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    setUploading(batchId);
    setError(null);
    setProgress(null);
    try {
      const response = await api.exportToDrive(batchId, mapping);
      // Queued, not finished - handleDrive returns right away and poll()
      // takes over reporting progress. This is the actual fix for "why does
      // it take so long": staff are never stuck on this click waiting for
      // every product to finish uploading one at a time.
      await poll(batchId, response.alreadyExported);
    } catch (err) {
      setUploading(null);
      setError(err instanceof ApiError ? err.message : 'Drive upload failed.');
    }
  }, [mapping, poll]);

  const active = mappings.find((m) => m.id === mapping);

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-red-800 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <label htmlFor="mapping" className="block text-sm font-medium text-stone-700 mb-2">ERP column format</label>
        <select
          id="mapping"
          value={mapping}
          onChange={(e) => setMapping(e.target.value)}
          className="w-full max-w-md rounded-lg border border-stone-300 px-3 py-2 text-sm"
        >
          {mappings.map((m) => (
            <option key={m.id} value={m.id}>{m.label} ({m.columnCount} columns)</option>
          ))}
        </select>
        {active?.description && <p className="mt-2 max-w-2xl text-xs leading-relaxed text-stone-500">{active.description}</p>}
        <p className="mt-2 text-xs text-stone-500">
          Need a different format? Drop a mapping file into <code className="rounded bg-stone-100 px-1">&lt;DATA_DIR&gt;/mappings/</code> and restart — no rebuild needed.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-stone-900">Shoots</h2>
        {batches.length === 0 && (
          <p className="rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-500">No shoots yet.</p>
        )}

        {batches.map((batch) => (
          <div key={batch.id} className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-stone-900">{batch.name}</p>
                <p className="text-xs text-stone-500">
                  {batch.productCount ?? 0} item{batch.productCount === 1 ? '' : 's'} ·{' '}
                  {new Date(batch.createdAt).toLocaleDateString('en-IN')}
                  {batch.closedAt ? ' · closed' : ' · open'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {/* download (not just href) matters on a phone: without it, tapping
                    this hands the whole screen to the phone's file viewer with no
                    way back to the app - especially bad when the app is opened
                    from a home-screen icon, which has no browser bar under it at
                    all. download keeps the tap inside the page and just saves the
                    file, the same way it would on a computer. */}
                <a
                  href={api.csvUrl(batch.id, mapping)}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
                >
                  <Download className="w-4 h-4" /> CSV
                </a>
                <a
                  href={api.zipUrl(batch.id, mapping)}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800"
                >
                  <Archive className="w-4 h-4" /> ZIP with photos
                </a>
                {driveConfigured && (
                  <button
                    type="button"
                    onClick={() => handleDrive(batch.id)}
                    disabled={uploading === batch.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-60"
                  >
                    {uploading === batch.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <CloudUpload className="w-4 h-4" />}
                    Drive
                  </button>
                )}
              </div>
            </div>

            {progress?.batchId === batch.id && (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                  progress.inProgress > 0
                    ? 'bg-blue-50 text-blue-900'
                    : progress.failed > 0
                      ? 'bg-amber-50 text-amber-900'
                      : 'bg-emerald-50 text-emerald-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  {progress.inProgress > 0
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : progress.failed > 0 ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  <span>
                    {progress.inProgress > 0
                      ? `Uploading… ${progress.succeeded} of ${progress.total} done`
                      : `${progress.succeeded} uploaded`}
                    {progress.alreadyExported > 0 && `, ${progress.alreadyExported} already in Drive (skipped)`}
                    {progress.failed > 0 && progress.inProgress === 0 && `, ${progress.failed} failed — retry to pick up just the failures`}
                  </span>
                </div>
                {progress.folderLink && progress.inProgress === 0 && (
                  <a href={progress.folderLink} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline">
                    <FolderOpen className="w-3 h-3" /> Open the Drive folder
                  </a>
                )}
                {progress.failures.length > 0 && progress.inProgress === 0 && (
                  <ul className="mt-2 space-y-1 border-t border-amber-200 pt-2 text-xs">
                    {progress.failures.map((f) => (
                      <li key={f.cpc}><strong>{f.cpc || 'unknown item'}:</strong> {f.error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      <p className="text-xs text-stone-500">
        Only approved items are exported. Anything still awaiting review is left out on purpose.
      </p>
    </div>
  );
};
