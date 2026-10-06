// Share finished products straight from the studio: the photo and caption go to
// WhatsApp, Instagram or any app on the phone through the share sheet. A price is
// typed here once; it goes into the caption and is what lets the product into
// the Meta catalogue feed.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Share2, Copy, Download, MessageCircle, Search, Check, AlertTriangle, X } from 'lucide-react';
import { api, ApiError } from '../api';
import type { Product } from '../types';
import { buildShareCaption, cleanPrice, formatRupees } from '../../server/sharing/caption';
import { SimilarPieces } from '../components/SimilarList';
import { ComboBox, type ComboOption } from '../components/ComboBox';
import { shareProduct, copyText, savePhoto, whatsappTextUrl } from '../utils/share';

const STATUSES = 'approved,exported';
const PAGE = 60;

export const ShareView: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [minWeight, setMinWeight] = useState('');
  const [maxWeight, setMaxWeight] = useState('');
  const [categories, setCategories] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The categories that actually have shareable products, with how many each.
  useEffect(() => {
    api.productCategories(STATUSES)
      .then((res) => setCategories(res.categories.map((c) => ({ value: c.type, hint: `${c.count}`, aliases: c.aliases }))))
      .catch(() => setCategories([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.listProducts({ status: STATUSES, search, limit: PAGE, category: category.trim(), minWeight: minWeight.trim(), maxWeight: maxWeight.trim() });
      setProducts(res.products);
      setTotal(res.total ?? res.products.length);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load products.');
    } finally {
      setLoading(false);
    }
  }, [search, category, minWeight, maxWeight]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const replace = (updated: Product) => setProducts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
  const filtered = Boolean(category.trim() || minWeight.trim() || maxWeight.trim() || search.trim());
  const clearAll = () => {
    setSearch('');
    setCategory('');
    setMinWeight('');
    setMaxWeight('');
  };
  const weightInput = (value: string, set: (v: string) => void, label: string) => (
    <input
      inputMode="decimal"
      value={value}
      onChange={(e) => set(e.target.value.replace(/[^0-9.,]/g, ''))}
      placeholder={label}
      aria-label={label}
      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400"
    />
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find by name or CPC"
          aria-label="Find a product to share"
          className="w-full rounded-xl border border-stone-300 bg-white py-3 pl-10 pr-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
        <ComboBox value={category} onChange={setCategory} options={categories} label="Category" placeholder="Category - pick or type, e.g. Haar" />
        {weightInput(minWeight, setMinWeight, 'From grams')}
        {weightInput(maxWeight, setMaxWeight, 'To grams')}
        {filtered ? (
          <button type="button" onClick={clearAll} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-stone-300 px-4 text-sm text-stone-700 hover:bg-stone-50">
            <X className="h-4 w-4" /> Clear
          </button>
        ) : <span className="hidden sm:block" />}
      </div>
      {!loading && total !== null && filtered && products.length > 0 && (
        <p className="text-sm text-stone-500">
          {total > products.length ? `Showing the newest ${products.length} of ${total} matching pieces.` : `${total} matching piece${total === 1 ? '' : 's'}.`}
        </p>
      )}
      {error && <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
      {!loading && products.length === 0 && (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-500">
          {filtered ? 'No approved piece matches these filters. Widen the weight range or clear the category.' : 'Nothing to share yet. Products appear here once they are approved in Review.'}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => <ShareCard key={p.id} product={p} onUpdated={replace} />)}
      </div>
    </div>
  );
};

const ShareCard: React.FC<{ product: Product; onUpdated: (p: Product) => void }> = ({ product, onUpdated }) => {
  const [price, setPrice] = useState(product.priceInr);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const savedPrice = useRef(product.priceInr);

  const photoId = product.processedPhotoId || product.originalPhotoId;
  const photoUrl = photoId ? api.photoUrl(photoId) : '';
  const caption = buildShareCaption({ name: product.name || product.itemType, description: product.description, searchKeywords: product.seoKeywords, priceInr: price });
  const say = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote(null), 5000);
  };

  const savePrice = async () => {
    const cleaned = cleanPrice(price);
    if (cleaned === savedPrice.current) return;
    try {
      const res = await api.updateProduct(product.id, { priceInr: cleaned });
      savedPrice.current = cleaned;
      setPrice(cleaned);
      onUpdated(res.product);
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not save the price.');
    }
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      say((err as Error).message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const share = () => run(async () => {
    const outcome = await shareProduct({ photoUrl, name: product.name || product.itemType, caption });
    if (outcome === 'shared') say('Caption copied too - paste it if the app did not take the text (Instagram does not).');
    if (outcome === 'saved') say('This phone cannot share photos from here, so the photo was saved and the caption copied.');
  });

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white">
      {photoUrl && <img src={photoUrl} alt={product.name || product.itemType} className="aspect-square w-full bg-stone-50 object-contain" />}
      <div className="flex-1 space-y-2 p-4">
        <p className="text-sm font-semibold text-stone-900">{product.name || product.itemType || 'Untitled'}</p>
        <p className="text-xs text-stone-500">{product.cpc || 'No CPC'} · {product.purity} · {product.netWeightGrams || '—'}g</p>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <span className="shrink-0">Price ₹</span>
          <input
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => void savePrice()}
            placeholder="e.g. 45000"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400"
          />
        </label>
        {cleanPrice(price) && <p className="text-xs text-stone-400">Shows as {formatRupees(price)}</p>}
        <SimilarPieces productId={product.id} />
        {!product.description && <p className="text-xs text-amber-700">The description is not written yet - the caption will be short.</p>}
      </div>
      <div className="space-y-2 border-t border-stone-200 p-3">
        <button
          type="button"
          onClick={() => void share()}
          disabled={busy || !photoUrl}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          <Share2 className="h-4 w-4" /> Share photo + caption
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void run(async () => { say((await copyText(caption)) ? 'Caption copied.' : 'Could not copy - select and copy it by hand.'); })} className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50">
            <Copy className="h-4 w-4" /> Copy caption
          </button>
          <button type="button" onClick={() => void run(() => savePhoto(photoUrl, product.name || product.itemType))} disabled={!photoUrl} className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60">
            <Download className="h-4 w-4" /> Save photo
          </button>
          <a href={whatsappTextUrl(caption)} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50">
            <MessageCircle className="h-4 w-4" /> WhatsApp text
          </a>
        </div>
        {note && <p role="status" className="flex items-start gap-1.5 text-xs text-emerald-800"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />{note}</p>}
      </div>
    </article>
  );
};
