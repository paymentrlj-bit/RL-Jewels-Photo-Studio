export type GoldPurity = '18kt' | '22kt' | '24kt';

export type ProductGender = "women's" | "men's" | 'unisex' | "kids'";

export type PhotoSlotType = 
  | 'hero'
  | 'angle_1'
  | 'angle_2'
  | 'angle_3'
  | 'macro_hallmark';

export type PhotoStatus = 'idle' | 'processing' | 'approved' | 'needs_reshoot' | 'error';

export type ReviewDecision = 'pending' | 'approved' | 'regenerating' | 'discarded';

export interface PhotoItem {
  id: string;
  type: PhotoSlotType;
  title: string;
  description: string;
  required: boolean;
  originalImage: string; // base64 data URL
  mimeType: string;
  status: PhotoStatus;
  reshootReason?: string;
  confidenceScore?: number;
  processedImage?: string; // base64 data URL
  reviewDecision: ReviewDecision;
  tryonImage?: string;
  tryonSettings?: TryonConfig;
  processedAt?: string;
}

export interface TryonConfig {
  skinTone: 'Warm Golden Indian' | 'Wheatish Medium' | 'Fair Olive' | 'Deep Rich Dusky';
  backdrop: 'Traditional Festive & Velvet' | 'Modern Pastel Studio' | 'Royal Heritage Silk' | 'Minimalist Luxury Pure';
  modelGender: "women's" | "men's" | 'unisex' | "kids'";
  stylingNotes?: string;
}

export interface ProductRecord {
  id: string;
  sku: string; // CPC Number (e.g. RLJ-RN-8821)
  cpc: string; // Primary Counter Product Code
  name: string;
  itemType: string;
  purity: GoldPurity;
  gender: ProductGender;
  size?: string;
  grossWeightGrams: string;
  otherWeightGrams: string;
  netWeightGrams: string;
  weightGrams?: string; // Legacy fallback
  staffName: string;
  createdAt: string;
  photos: PhotoItem[];
  overallStatus: 'draft' | 'processing' | 'reviewed' | 'exported';
}

export interface AuditLogItem {
  id: string;
  sku: string;
  cpc?: string;
  productName: string;
  itemType: string;
  purity: GoldPurity;
  gender: ProductGender;
  size?: string;
  grossWeightGrams: string;
  otherWeightGrams: string;
  netWeightGrams: string;
  weightGrams?: string;
  staffName: string;
  date: string;
  approvedPhotosCount: number;
  hasTryon: boolean;
  csvRow: string;
  photosSummary: {
    slot: PhotoSlotType;
    filename: string;
    status: string;
    hasProcessed: boolean;
  }[];
}

export interface UserSession {
  username: string;
  isAdmin: boolean;
  loggedInAt: string;
}

export interface AuthConfig {
  adminPassword: string;
  staffPassword: string;
}

export const ITEM_TYPE_SUGGESTIONS = [
  'ring',
  'earrings',
  'necklace',
  'bangle',
  'mangalsutra',
  'pendant',
  'chain',
  'kada',
  'bracelet',
  'anklet',
  'nose pin',
  'waist chain',
  'temple set',
  'bridal set',
  "kids' jewellery",
  'coin/bar',
  'other'
] as const;

export const STAFF_MEMBERS = [
  'Rahul Sharma (Counter 1)',
  'Priya Patel (Counter 2)',
  'Anand Verma (Counter 3)',
  'Sunita Rao (Manager)',
  'Counter Staff (Default)'
];

