import { GoldPurity, ProductGender, PhotoItem } from '../types';

export interface ProductDraft {
  cpc: string;
  productName: string;
  itemType: string;
  purity: GoldPurity;
  gender: ProductGender;
  size?: string;
  grossWeight: string;
  otherWeight: string;
  netWeight: string;
  staffName: string;
  photos: PhotoItem[];
  currentStep: 'form' | 'upload' | 'processing' | 'review' | 'export';
  lastSavedAt: string;
  version: number;
}

const DRAFT_STORAGE_KEY = 'rlj_studio_active_draft_v1';
const DRAFT_META_KEY = 'rlj_studio_draft_meta_v1';

/**
 * Saves current product form and photo state to LocalStorage
 */
export function saveProductDraft(draft: Omit<ProductDraft, 'lastSavedAt' | 'version'>): { success: boolean; timestamp: string } {
  const timestamp = new Date().toISOString();
  const payload: ProductDraft = {
    ...draft,
    lastSavedAt: timestamp,
    version: 1,
  };

  try {
    const serialized = JSON.stringify(payload);
    localStorage.setItem(DRAFT_STORAGE_KEY, serialized);
    localStorage.setItem(
      DRAFT_META_KEY,
      JSON.stringify({
        cpc: draft.cpc,
        itemType: draft.itemType,
        photosCount: draft.photos.filter((p) => Boolean(p.originalImage)).length,
        timestamp,
      })
    );
    return { success: true, timestamp };
  } catch (error: any) {
    console.warn('Draft auto-save warning (possible storage limit):', error);

    // If quota exceeded due to high-res images, try saving metadata and form fields without heavy originals
    try {
      const lightweightPhotos = draft.photos.map((p) => ({
        ...p,
        // keep processed or thumbnail if possible, or omit if too large
        originalImage: p.originalImage.length > 500000 ? p.originalImage.slice(0, 50000) : p.originalImage,
      }));
      const fallbackPayload = {
        ...draft,
        photos: lightweightPhotos,
        lastSavedAt: timestamp,
        version: 1,
      };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(fallbackPayload));
      return { success: true, timestamp };
    } catch (fallbackError) {
      console.error('Failed to write even lightweight draft to LocalStorage:', fallbackError);
      return { success: false, timestamp };
    }
  }
}

/**
 * Loads the active product draft from LocalStorage if available
 */
export function loadProductDraft(): ProductDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.cpc) {
      return parsed as ProductDraft;
    }
  } catch (e) {
    console.error('Error reading draft from LocalStorage:', e);
  }
  return null;
}

/**
 * Clears the saved draft upon fresh new product creation or successful export
 */
export function clearProductDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    localStorage.removeItem(DRAFT_META_KEY);
  } catch (e) {
    console.error('Error clearing draft:', e);
  }
}

/**
 * Checks if a valid draft exists
 */
export function hasProductDraft(): boolean {
  try {
    return Boolean(localStorage.getItem(DRAFT_STORAGE_KEY));
  } catch {
    return false;
  }
}
