// The capture screen.
//
// The whole design goal: a staff member should be able to photograph an item
// and move to the next one without ever waiting for the AI. Submitting queues
// the work and clears the form immediately; the strip along the bottom shows
// what is still cooking.
//
// v1 blocked here for up to five minutes per item, which is why it could only
// ever do one product at a time.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, ScanLine, Aperture, Loader2, AlertTriangle, CheckCircle2,
  RotateCcw, Upload, History,
} from 'lucide-react';
import { api, ApiError } from '../api';
import { ITEM_TYPE_SUGGESTIONS } from '../itemTypes';
import type { Batch, CpcLookupResult, GoldPurity, Product, ProductGender } from '../types';
import { STATUS_LABELS } from '../types';
import { CameraModal } from '../components/CameraModal';
import { ScannerModal } from '../components/ScannerModal';
import { downscaleImage } from '../utils/imagePreflight';
import { logClientEvent } from '../utils/analytics';

const PURITIES: GoldPurity[] = ['18kt', '22kt', '24kt'];
const GENDERS: ProductGender[] = ["women's", "men's", 'unisex', "kids'"];

interface FormState {
  cpc: string;
  itemType: string;
  purity: GoldPurity;
  gender: ProductGender;
  size: string;
  grossWeightGrams: string;
  otherWeightGrams: string;
  netWeightGrams: string;
}

const EMPTY_FORM: FormState = {
  cpc: '',
  itemType: '',
  purity: '22kt',
  gender: "women's",
  size: 'DEFAULT',
  grossWeightGrams: '',
  otherWeightGrams: '',
  netWeightGrams: '',
};

interface ShootViewProps {
  batch: Batch | null;
  studioCameraAvailable: boolean;
  onQueued: () => void;
  recent: Product[];
}

export const ShootView: React.FC<ShootViewProps> = ({ batch, studioCameraAvailable, onQueued, recent }) => {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [photo, setPhoto] = useState<string | null>(null);
  const [lookup, setLookup] = useState<CpcLookupResult | null>(null);
  const [isCameraOpen, setCameraOpen] = useState(false);
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isCapturingDslr, setCapturingDslr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justQueued, setJustQueued] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cpcInputRef = useRef<HTMLInputElement | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Net weight is gross minus other, and staff should not have to do that sum
  // at the counter. Typed values still win - this only fills a blank.
  useEffect(() => {
    const gross = parseFloat(form.grossWeightGrams);
    const other = parseFloat(form.otherWeightGrams || '0');
    if (Number.isFinite(gross) && Number.isFinite(other) && !form.netWeightGrams) {
      const net = gross - other;
      if (net > 0) set('netWeightGrams', net.toFixed(3));
    }
  }, [form.grossWeightGrams, form.otherWeightGrams, form.netWeightGrams]);

  const runLookup = useCallback(async (cpc: string) => {
    if (!cpc.trim()) {
      setLookup(null);
      return;
    }
    try {
      const result = await api.cpcLookup(cpc);
      setLookup(result);

      if (result.record && result.matchType !== 'none') {
        // Auto-fill from the store's own catalogue rather than making anyone
        // retype it. A 'guess' match is still filled in, but flagged below so
        // the size gets a second look.
        setForm((f) => ({
          ...f,
          itemType: f.itemType || result.record!.styleName,
          size: result.record!.sizeName || f.size,
          purity: result.normalizedPurity || f.purity,
          gender: result.genderGuess || f.gender,
        }));
      }
    } catch {
      // A lookup failure is not worth blocking capture over - the staff
      // member can type the fields in.
      setLookup(null);
    }
  }, []);

  const handleScan = useCallback((code: string) => {
    setScannerOpen(false);
    set('cpc', code);
    void runLookup(code);
    logClientEvent('cpc_scanned', { length: code.length });
  }, [runLookup]);

  const handleCapture = useCallback(async (dataUrl: string) => {
    setCameraOpen(false);
    // Downscaled before it ever leaves the browser: a modern phone camera
    // produces 4-8MB frames and nothing downstream benefits from more than
    // 2200px on the long edge.
    setPhoto(await downscaleImage(dataUrl, 2200, 0.92));
  }, []);

  const handleDslrCapture = useCallback(async () => {
    setCapturingDslr(true);
    setError(null);
    try {
      const result = await api.dslrCapture();
      setPhoto(result.imageBase64);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Studio camera capture failed.');
    } finally {
      setCapturingDslr(false);
    }
  }, []);

  const handleFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setPhoto(await downscaleImage(String(reader.result), 2200, 0.92));
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }, []);

  const canSubmit = Boolean(photo && form.itemType.trim() && !isSubmitting);

  const handleSubmit = useCallback(async () => {
    if (!photo || !form.itemType.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const { product } = await api.createProduct({ ...form, batchId: batch?.id });
      await api.attachPhoto(product.id, photo, 'upload');

      // Teach the catalogue about a CPC it did not know, so the next scan of
      // this product auto-fills instead of starting blank.
      if (lookup?.matchType === 'none' && lookup.productId && form.itemType.trim()) {
        void api.learnCpc({
          cpcNumber: form.cpc,
          styleName: form.itemType,
          sizeName: form.size,
          groupName: 'GOLD',
          purity: form.purity.replace('kt', ' Ct'),
        }).catch(() => undefined);
      }

      setJustQueued(form.cpc || form.itemType);
      // Reset immediately - this is what makes the next capture instant.
      setForm(EMPTY_FORM);
      setPhoto(null);
      setLookup(null);
      onQueued();
      cpcInputRef.current?.focus();

      window.setTimeout(() => setJustQueued(null), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not queue this item.');
    } finally {
      setSubmitting(false);
    }
  }, [photo, form, batch, lookup, onQueued]);

  const itemTypeOptions = useMemo(() => ITEM_TYPE_SUGGESTIONS, []);

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6">
      <div className="space-y-5">
        {justQueued && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-emerald-800 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span><strong>{justQueued}</strong> is queued. Next piece, please.</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-red-800 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* --- photo --- */}
        <section className="bg-white rounded-2xl border border-stone-200 p-5">
          <h2 className="font-semibold text-stone-900 mb-4">1. Photograph the piece</h2>

          {photo ? (
            <div className="space-y-3">
              <img src={photo} alt="Captured piece" className="w-full max-h-80 object-contain rounded-xl bg-stone-50" />
              <button
                type="button"
                onClick={() => setPhoto(null)}
                className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-stone-900"
              >
                <RotateCcw className="w-4 h-4" /> Retake
              </button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-3 gap-3">
              {studioCameraAvailable && (
                <button
                  type="button"
                  onClick={handleDslrCapture}
                  disabled={isCapturingDslr}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-6 hover:bg-amber-100 disabled:opacity-60"
                >
                  {isCapturingDslr
                    ? <Loader2 className="w-6 h-6 animate-spin text-amber-700" />
                    : <Aperture className="w-6 h-6 text-amber-700" />}
                  <span className="text-sm font-medium text-amber-900">
                    {isCapturingDslr ? 'Capturing…' : 'Studio camera'}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-stone-200 px-4 py-6 hover:bg-stone-50"
              >
                <Camera className="w-6 h-6 text-stone-700" />
                <span className="text-sm font-medium text-stone-800">Phone camera</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-stone-200 px-4 py-6 hover:bg-stone-50"
              >
                <Upload className="w-6 h-6 text-stone-700" />
                <span className="text-sm font-medium text-stone-800">Upload a file</span>
              </button>
            </div>
          )}

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </section>

        {/* --- details --- */}
        <section className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
          <h2 className="font-semibold text-stone-900">2. Confirm the details</h2>

          <div>
            <label htmlFor="cpc" className="block text-sm font-medium text-stone-700 mb-1">CPC number</label>
            <div className="flex gap-2">
              <input
                id="cpc"
                ref={cpcInputRef}
                value={form.cpc}
                onChange={(e) => set('cpc', e.target.value)}
                onBlur={(e) => void runLookup(e.target.value)}
                placeholder="e.g. 1265L1051"
                className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-800"
              >
                <ScanLine className="w-4 h-4" /> Scan
              </button>
            </div>

            {lookup && <LookupBanner lookup={lookup} />}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="itemType" className="block text-sm font-medium text-stone-700 mb-1">
                Item type <span className="text-red-500">*</span>
              </label>
              <input
                id="itemType"
                list="item-types"
                value={form.itemType}
                onChange={(e) => set('itemType', e.target.value)}
                placeholder="e.g. Bangle"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
              <datalist id="item-types">
                {itemTypeOptions.map((type) => <option key={type} value={type} />)}
              </datalist>
            </div>

            <div>
              <label htmlFor="size" className="block text-sm font-medium text-stone-700 mb-1">Size</label>
              <input
                id="size"
                value={form.size}
                onChange={(e) => set('size', e.target.value)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
            </div>

            <div>
              <label htmlFor="purity" className="block text-sm font-medium text-stone-700 mb-1">Purity</label>
              <select
                id="purity"
                value={form.purity}
                onChange={(e) => set('purity', e.target.value as GoldPurity)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              >
                {PURITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="gender" className="block text-sm font-medium text-stone-700 mb-1">Intended for</label>
              <select
                id="gender"
                value={form.gender}
                onChange={(e) => set('gender', e.target.value as ProductGender)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              >
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {([
              ['grossWeightGrams', 'Gross (g)'],
              ['otherWeightGrams', 'Other (g)'],
              ['netWeightGrams', 'Net (g)'],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label htmlFor={key} className="block text-sm font-medium text-stone-700 mb-1">{label}</label>
                <input
                  id={key}
                  inputMode="decimal"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  placeholder="0.000"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                />
              </div>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full rounded-xl bg-amber-600 px-6 py-4 font-semibold text-white hover:bg-amber-700 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Queueing…' : 'Queue for processing, shoot the next one'}
        </button>
        {!canSubmit && !isSubmitting && (
          <p className="text-center text-sm text-stone-500">
            {!photo ? 'Take a photo to continue.' : 'Item type is required.'}
          </p>
        )}
      </div>

      {/* --- live queue strip --- */}
      <aside className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-700">
          <History className="w-4 h-4" /> Just shot
        </div>
        {recent.length === 0 && (
          <p className="text-sm text-stone-500 rounded-xl border border-dashed border-stone-300 p-4">
            Nothing yet this session. Items you queue appear here and keep processing in the background.
          </p>
        )}
        {recent.map((product) => (
          <div key={product.id} className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3">
            {product.processedPhotoId || product.originalPhotoId ? (
              <img
                src={api.photoUrl((product.processedPhotoId || product.originalPhotoId)!)}
                alt=""
                className="w-12 h-12 rounded-lg object-cover bg-stone-100"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-stone-100" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-stone-900">{product.cpc || product.itemType}</p>
              <p className="truncate text-xs text-stone-500">{product.itemType}</p>
            </div>
            <StatusPill product={product} />
          </div>
        ))}
      </aside>

      <CameraModal
        isOpen={isCameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCapture}
        title="Photograph the piece"
      />
      <ScannerModal isOpen={isScannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />
    </div>
  );
};

const LookupBanner: React.FC<{ lookup: CpcLookupResult }> = ({ lookup }) => {
  if (lookup.matchType === 'none') {
    return (
      <p className="mt-2 text-xs text-stone-500">
        Not in the catalogue yet. Fill in the details and this CPC will be remembered for next time.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      <p className={`text-xs ${lookup.matchType === 'certain' ? 'text-emerald-700' : 'text-amber-700'}`}>
        {lookup.matchType === 'certain' ? 'Matched:' : 'Best guess — check the size:'}{' '}
        <strong>{lookup.record?.styleName}</strong>
        {lookup.record?.sizeName ? ` · ${lookup.record.sizeName}` : ''}
        {lookup.record?.purity ? ` · ${lookup.record.purity}` : ''}
      </p>
      {lookup.previousShoots.length > 0 && (
        // The duplicate-work check. Over 3,247 products this is the single
        // most valuable thing this screen tells anyone.
        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5">
          Already shot {lookup.previousShoots.length === 1 ? 'once' : `${lookup.previousShoots.length} times`} —
          most recently {new Date(lookup.previousShoots[0].createdAt).toLocaleDateString('en-IN')}. Shoot again only if you mean to replace it.
        </p>
      )}
    </div>
  );
};

const StatusPill: React.FC<{ product: Product }> = ({ product }) => {
  const stage = product.job?.stage;
  const tone =
    product.status === 'awaiting_review' || product.status === 'approved' ? 'bg-emerald-100 text-emerald-800'
    : product.status === 'needs_reshoot' || product.status === 'failed' ? 'bg-red-100 text-red-800'
    : product.status === 'processing' ? 'bg-blue-100 text-blue-800'
    : 'bg-stone-100 text-stone-700';

  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {product.status === 'processing' && stage ? stage : STATUS_LABELS[product.status]}
    </span>
  );
};
