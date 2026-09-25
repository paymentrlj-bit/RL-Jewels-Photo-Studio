// The capture screen.
//
// The whole design goal: a staff member should be able to photograph an item
// and move to the next one without ever waiting for the AI. Submitting queues
// the work and clears the form immediately; the strip along the bottom shows
// what is still cooking.
//
// v1 blocked here for up to five minutes per item, which is why it could only
// ever do one product at a time.
//
// Capture is phone-only. The tethered-DSLR path was removed: after repeated
// testing at the store it never worked the way it needed to, and keeping a
// half-working second capture route around is worse than not having one.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Camera, ScanLine, AlertTriangle, CheckCircle2,
  RotateCcw, Video, History, Eye, Plus, X,
} from 'lucide-react';
import { api, ApiError } from '../api';
import { ITEM_TYPE_SUGGESTIONS } from '../itemTypes';
import type { Batch, CpcLookupResult, GoldPurity, Product, ProductGender } from '../types';
import { STATUS_LABELS } from '../types';
import { CameraModal } from '../components/CameraModal';
import { AngleCaptureButton } from '../components/AngleCaptureButton';
import { ScannerModal } from '../components/ScannerModal';
import { downscaleImage, analyzeImageQuality, checkFlashFired, type PreflightIssue } from '../utils/imagePreflight';
import { logClientEvent } from '../utils/analytics';
import { computeNetWeight } from '../../server/catalog/weights';
import { isElongated } from '../../server/catalog/taxonomy';

// getUserMedia - the in-app live camera and the barcode scanner - is blocked
// by browsers outside a secure context. On the shop LAN that means plain
// http://<lenovo-ip>:3000 gets no live camera on staff phones.
//
// The file input below is the way round it: `capture="environment"` opens the
// phone's OWN camera app, which needs no secure context at all. So capture
// keeps working over plain HTTP; only the live preview and the live tag
// scanner need HTTPS (without it, the scanner reads a photo of the tag).
const IS_SECURE_CONTEXT =
  typeof window !== 'undefined' &&
  (window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Mirrors MAX_ANGLE_PHOTOS in server/ai/inventory.ts (not imported directly -
// that file pulls in `sharp`, a native module that cannot run in the
// browser bundle). Keep the two in sync by hand if either changes.
const MAX_EXTRA_PHOTOS = 2;

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
}

const EMPTY_FORM: FormState = {
  cpc: '',
  itemType: '',
  purity: '22kt',
  gender: "women's",
  size: 'DEFAULT',
  grossWeightGrams: '',
  otherWeightGrams: '',
};

interface ShootViewProps {
  batch: Batch | null;
  onQueued: () => void;
  recent: Product[];
  /** Pieces the pipeline paused on because part of them was hidden. */
  needsAngle: Product[];
}

export const ShootView: React.FC<ShootViewProps> = ({ batch, onQueued, recent, needsAngle }) => {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [photo, setPhoto] = useState<string | null>(null);
  const [lookup, setLookup] = useState<CpcLookupResult | null>(null);
  const [isCameraOpen, setCameraOpen] = useState(false);
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[]>([]);
  const [isChecking, setChecking] = useState(false);
  // Set once the staff member has explicitly acknowledged a flagged photo.
  // Advisory checks must not be silently dismissable - a blurred photo is
  // unfixable by any amount of AI enhancement, and sending it burns a full
  // paid pipeline run for a guaranteed reshoot.
  const [issuesAcknowledged, setIssuesAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justQueued, setJustQueued] = useState<string | null>(null);
  // Extra photos of the SAME piece, added up front rather than waiting for
  // the pipeline to notice something was hidden and ask after the fact -
  // useful for a long chain, a piece with detail on the back, or anything
  // staff already know a single photo won't fully capture.
  const [extraPhotos, setExtraPhotos] = useState<string[]>([]);
  const [addingExtraPhoto, setAddingExtraPhoto] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const extraPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const cpcInputRef = useRef<HTMLInputElement | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Net is never typed: Gross - Other, or Gross when Other is blank or 0.
  // Recomputed on every keystroke so it can never go stale.
  const netWeight = useMemo(
    () => computeNetWeight(form.grossWeightGrams, form.otherWeightGrams),
    [form.grossWeightGrams, form.otherWeightGrams]
  );

  // Long pieces (chains, mangalsutras, haars, waist chains...) are the ones
  // most likely to spill off a counter mat sized for a ring or a pair of
  // earrings, and the ones a single photo most often fails to cover end to
  // end. Known as soon as a CPC scan fills the item type in, or as soon as
  // staff type/pick one - whichever happens first for this piece.
  const isLongPiece = useMemo(() => Boolean(form.itemType.trim() && isElongated(form.itemType)), [form.itemType]);

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
  }, [runLookup]);

  // Accepts a freshly captured photo: downscale, then run the free local
  // quality checks before this ever reaches a paid API call.
  const acceptPhoto = useCallback(async (dataUrl: string, file?: File) => {
    setChecking(true);
    setIssuesAcknowledged(false);
    setPreflightIssues([]);
    try {
      // Downscaled before it ever leaves the browser: a modern phone camera
      // produces 4-8MB frames and nothing downstream benefits from more than
      // 2200px on the long edge.
      const scaled = await downscaleImage(dataUrl, 2200, 0.92);
      setPhoto(scaled);

      const { issues } = await analyzeImageQuality(scaled);

      // EXIF only survives on an uploaded file, not on a canvas capture.
      // Flash very often blows out highlights on polished gold, so it is
      // worth its own warning where the data exists.
      if (file) {
        const flashFired = await checkFlashFired(file);
        if (flashFired) {
          issues.push({
            code: 'flash_fired',
            message: 'The flash fired. On polished gold this usually blows out the highlights - try again without it.',
          });
        }
      }

      setPreflightIssues(issues);
      if (issues.length > 0) {
        logClientEvent('preflight_flagged', { codes: issues.map((i) => i.code) });
      }
    } finally {
      setChecking(false);
    }
  }, []);

  const handleCapture = useCallback(async (dataUrl: string) => {
    setCameraOpen(false);
    await acceptPhoto(dataUrl);
  }, [acceptPhoto]);

  const handleFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void acceptPhoto(String(reader.result), file);
    reader.readAsDataURL(file);
    event.target.value = '';
  }, [acceptPhoto]);

  const clearPhoto = useCallback(() => {
    setPhoto(null);
    setPreflightIssues([]);
    setIssuesAcknowledged(false);
    setExtraPhotos([]);
  }, []);

  const handleExtraPhoto = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setAddingExtraPhoto(true);
      try {
        const scaled = await downscaleImage(String(reader.result), 2200, 0.92);
        setExtraPhotos((prev) => [...prev, scaled].slice(0, MAX_EXTRA_PHOTOS));
      } finally {
        setAddingExtraPhoto(false);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const removeExtraPhoto = useCallback((index: number) => {
    setExtraPhotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // A flagged photo is not blocked outright - staff sometimes know better than
  // a heuristic - but it does need an explicit acknowledgement first.
  const needsAcknowledgement = preflightIssues.length > 0 && !issuesAcknowledged;
  // The real duplicate-work rule: this exact tag is already mid-process
  // somewhere else in the system, so a new capture here would just be a
  // second, parallel entry for the same physical piece.
  const activeDuplicate = lookup?.activeDuplicate ?? null;
  const canSubmit = Boolean(photo && form.itemType.trim() && netWeight.ok && !activeDuplicate && !isSubmitting && !isChecking && !needsAcknowledgement);

  const handleSubmit = useCallback(async () => {
    if (!photo || !form.itemType.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const { product } = await api.createProduct({ ...form, batchId: batch?.id });
      await api.attachPhoto(product.id, photo, 'upload');

      // Extra photos staff added up front (long piece, detail on the back)
      // go in as angle photos, same as ones added reactively after an audit
      // flag - the pipeline treats both the same way. Sequential, not
      // parallel: they land on the same product record, and skipping one
      // that fails is better than losing the whole submit over it.
      for (const extra of extraPhotos) {
        await api.addAngle(product.id, extra).catch(() => undefined);
      }

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
      setPreflightIssues([]);
      setIssuesAcknowledged(false);
      setExtraPhotos([]);
      setLookup(null);
      onQueued();
      cpcInputRef.current?.focus();

      window.setTimeout(() => setJustQueued(null), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not queue this item.');
    } finally {
      setSubmitting(false);
    }
  }, [photo, form, batch, lookup, onQueued, extraPhotos]);

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

        {/* Shown here rather than only on Review: the point is to catch staff
            while the piece is still on the counter, not an hour later. */}
        {needsAngle.length > 0 && (
          <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 space-y-3">
            <h2 className="flex items-center gap-2 font-semibold text-amber-900">
              <Eye className="w-4 h-4" /> One more photo needed ({needsAngle.length})
            </h2>
            {needsAngle.map((product) => (
              <div key={product.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3">
                {product.originalPhotoId && (
                  <img src={api.photoUrl(product.originalPhotoId)} alt="" className="h-14 w-14 rounded-lg object-cover bg-stone-100" />
                )}
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-medium text-stone-900">{product.cpc || product.itemType}</p>
                  {/* Says what's hidden and exactly what to do about it (move
                      the tag, turn it over, ...) - not just "another angle". */}
                  <p className="text-sm leading-snug text-stone-700">{product.auditReason}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <AngleCaptureButton productId={product.id} onAdded={onQueued} onError={setError} />
                  <button
                    type="button"
                    onClick={() => void api.requeue(product.id, { proceedWithoutAngle: true }).then(onQueued, (err) =>
                      setError(err instanceof ApiError ? err.message : 'Could not process it.'))}
                    className="min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
                  >
                    Process anyway
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* --- photo --- */}
        <section className="bg-white rounded-2xl border border-stone-200 p-5">
          <h2 className="font-semibold text-stone-900 mb-4">1. Photograph the piece</h2>

          {isLongPiece && (
            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              This is a long piece. Use a background bigger than the piece, and hold the camera far enough back that both ends and the clasp fit in one photo.
              {photo && ' Still doesn’t all fit? Use "Add another photo" below for the other end or the clasp.'}
            </div>
          )}

          {photo ? (
            <div className="space-y-3">
              <img src={photo} alt="Captured piece" className="w-full max-h-80 object-contain rounded-xl bg-stone-50" />

              {isChecking && <p className="text-sm text-stone-500">Checking the photo…</p>}

              {preflightIssues.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <Eye className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                    <div className="text-sm text-amber-900">
                      <p className="font-medium">Have a look at this photo before sending it.</p>
                      <ul className="mt-1.5 list-disc pl-4 space-y-1">
                        {preflightIssues.map((issue) => <li key={issue.code}>{issue.message}</li>)}
                      </ul>
                    </div>
                  </div>

                  {!issuesAcknowledged ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={clearPhoto}
                        className="min-h-[44px] rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
                      >
                        Retake it
                      </button>
                      <button
                        type="button"
                        onClick={() => setIssuesAcknowledged(true)}
                        className="min-h-[44px] rounded-lg border border-amber-400 px-4 py-2 text-sm text-amber-900 hover:bg-amber-100"
                      >
                        Send it anyway
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-800">Sending anyway - you can still retake it below.</p>
                  )}
                </div>
              )}

              {/* Optional, up front: for a long chain, a piece with detail on
                  the back, or anything staff already know one photo won't
                  cover, this is faster than waiting for the pipeline to ask
                  after the fact. Same photos, same limit, as the reactive
                  "one more photo needed" flow after a failed check. */}
              <div className="space-y-2">
                {extraPhotos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {extraPhotos.map((p, i) => (
                      <div key={i} className="relative">
                        <img src={p} alt={`Extra photo ${i + 1}`} className="h-16 w-16 rounded-lg object-cover bg-stone-100" />
                        <button
                          type="button"
                          onClick={() => removeExtraPhoto(i)}
                          aria-label="Remove this photo"
                          className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-white hover:bg-red-700"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {extraPhotos.length < MAX_EXTRA_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => extraPhotoInputRef.current?.click()}
                    disabled={addingExtraPhoto}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-60"
                  >
                    <Plus className="w-4 h-4" /> {addingExtraPhoto ? 'Adding…' : 'Add another photo (back, other angle)'}
                  </button>
                )}
              </div>
              <input
                ref={extraPhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleExtraPhoto}
              />

              <button
                type="button"
                onClick={clearPhoto}
                className="inline-flex min-h-[44px] items-center gap-2 text-sm text-stone-600 hover:text-stone-900"
              >
                <RotateCcw className="w-4 h-4" /> Retake
              </button>
            </div>
          ) : (
            <div className={`grid gap-3 ${IS_SECURE_CONTEXT ? 'sm:grid-cols-2' : ''}`}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-[44px] flex-col items-center gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-6 hover:bg-amber-100"
              >
                <Camera className="w-6 h-6 text-amber-700" />
                <span className="text-sm font-medium text-amber-900">Take a photo</span>
              </button>

              {IS_SECURE_CONTEXT && (
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="flex min-h-[44px] flex-col items-center gap-2 rounded-xl border-2 border-stone-200 px-4 py-6 hover:bg-stone-50"
                >
                  <Video className="w-6 h-6 text-stone-700" />
                  <span className="text-sm font-medium text-stone-800">Live camera view</span>
                </button>
              )}
            </div>
          )}

          {/* capture="environment" makes a phone open its rear camera app
              directly. Works over plain HTTP, unlike getUserMedia. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFile}
          />
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
              {/* Always offered: without HTTPS there is no live view, but
                  the scanner can still read a photo of the tag. */}
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-800"
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
            <div>
              <label htmlFor="netWeight" className="block text-sm font-medium text-stone-700 mb-1">Net (g)</label>
              <output
                id="netWeight"
                aria-live="polite"
                className="flex min-h-[38px] w-full items-center rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-sm font-medium text-stone-900"
              >
                {netWeight.ok && netWeight.net ? netWeight.net : <span className="text-stone-400">auto</span>}
              </output>
            </div>
          </div>
          {netWeight.ok ? (
            <p className="text-xs text-stone-500">Net is worked out for you: Gross − Other.</p>
          ) : (
            <p className="text-xs text-red-700">{netWeight.error}</p>
          )}
        </section>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="min-h-[44px] w-full rounded-xl bg-amber-600 px-6 py-4 font-semibold text-white hover:bg-amber-700 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Saving…' : 'Save and shoot the next one'}
        </button>
        {!canSubmit && !isSubmitting && (
          <p className="text-center text-sm text-stone-500">
            {!photo ? 'Take a photo to continue.'
              : isChecking ? 'Checking the photo…'
              : needsAcknowledgement ? 'Check the photo warnings above first.'
              : activeDuplicate ? 'This tag is already in the system - see the note above.'
              : !netWeight.ok ? netWeight.error
              : 'Item type is required.'}
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
  // The hard stop: this exact tag already has a piece in progress. Shown
  // whatever else the lookup found, and before anything else in this box -
  // it is the one thing that actually needs to change what staff do next.
  const duplicateNotice = lookup.activeDuplicate && (
    <p className="text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
      Already in the system: {lookup.activeDuplicate.itemType || 'no item type yet'}
      {' '}({STATUS_LABELS[lookup.activeDuplicate.status]}). Open it in <strong>Review</strong> instead of shooting it again.
    </p>
  );

  if (lookup.matchType === 'none') {
    return (
      <div className="mt-2 space-y-1">
        {duplicateNotice}
        <p className="text-xs text-stone-500">
          Not in the catalogue yet. Fill in the details and this CPC will be remembered for next time.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      {duplicateNotice}
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
    : product.status === 'needs_angle' ? 'bg-amber-100 text-amber-800'
    : product.status === 'needs_reshoot' || product.status === 'failed' ? 'bg-red-100 text-red-800'
    : product.status === 'processing' ? 'bg-blue-100 text-blue-800'
    : 'bg-stone-100 text-stone-700';

  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {product.status === 'processing' && stage ? stage : STATUS_LABELS[product.status]}
    </span>
  );
};
