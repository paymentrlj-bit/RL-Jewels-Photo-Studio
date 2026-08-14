import JSZip from 'jszip';
import { ProductRecord, PhotoItem, AuditLogItem } from '../types';

/**
 * Creates and triggers download of a ZIP containing all approved product images
 * named strictly by CPC according to specification (e.g. CPC_hero.jpg, CPC_angle1.jpg, CPC_tryon.jpg)
 * and includes the ERP CSV alongside it.
 */
export async function downloadProductZip(product: ProductRecord): Promise<void> {
  const zip = new JSZip();
  const cpc = product.cpc?.trim() || product.sku?.trim() || 'PRODUCT';

  // Helper to convert data URL to ArrayBuffer / Blob
  const dataUrlToBinary = (dataUrl: string): Uint8Array => {
    const base64 = dataUrl.split(',')[1] || dataUrl;
    const binaryStr = atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  };

  const filenames: string[] = [];

  // Add photos
  for (let i = 0; i < product.photos.length; i++) {
    const photo = product.photos[i];
    const imgData = photo.processedImage || photo.originalImage;
    if (!imgData) continue;

    let slotName = '';
    if (photo.type === 'hero') slotName = 'hero';
    else if (photo.type === 'angle_1') slotName = 'angle1';
    else if (photo.type === 'angle_2') slotName = 'angle2';
    else if (photo.type === 'angle_3') slotName = 'angle3';
    else if (photo.type === 'macro_hallmark') slotName = 'macro_hallmark';
    else slotName = `photo_${i + 1}`;

    const filename = `${cpc}_${slotName}.jpg`;
    filenames.push(filename);

    const binaryData = dataUrlToBinary(imgData);
    zip.file(filename, binaryData);

    // If there is a styled try-on image for this photo
    if (photo.tryonImage) {
      const tryonFilename = `${cpc}_tryon.jpg`;
      filenames.push(tryonFilename);
      const tryonBinary = dataUrlToBinary(photo.tryonImage);
      zip.file(tryonFilename, tryonBinary);
    }
  }

  // Generate and attach CSV
  const csvContent = generateErpCsv(product);
  zip.file(`${cpc}_erp_import.csv`, csvContent);

  // Generate zip package and download
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${cpc}_studio_pack.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates RFC-compliant structured CSV for bulk ERP / inventory import
 */
export function generateErpCsv(product: ProductRecord): string {
  const cpc = product.cpc?.trim() || product.sku?.trim() || 'RLJ-UNKNOWN';
  const heroPhoto = product.photos.find(p => p.type === 'hero');
  const angle1Photo = product.photos.find(p => p.type === 'angle_1');
  const angle2Photo = product.photos.find(p => p.type === 'angle_2');
  const macroPhoto = product.photos.find(p => p.type === 'macro_hallmark');
  const tryonPhoto = product.photos.find(p => Boolean(p.tryonImage));

  const heroFilename = heroPhoto ? `${cpc}_hero.jpg` : '';
  const angle1Filename = angle1Photo ? `${cpc}_angle1.jpg` : '';
  const angle2Filename = angle2Photo ? `${cpc}_angle2.jpg` : '';
  const macroFilename = macroPhoto ? `${cpc}_macro_hallmark.jpg` : '';
  const tryonFilename = tryonPhoto ? `${cpc}_tryon.jpg` : '';

  const headers = [
    'CPC',
    'product_name',
    'item_type',
    'gold_purity',
    'gender_category',
    'size',
    'gross_weight_grams',
    'other_weight_grams',
    'net_weight_grams',
    'hero_filename',
    'angle1_filename',
    'angle2_filename',
    'macro_hallmark_filename',
    'tryon_filename',
    'staff_member',
    'overall_status',
    'created_at'
  ];

  const escapeCsv = (val: string = '') => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const row = [
    escapeCsv(cpc),
    escapeCsv(product.name || `${product.purity} ${product.itemType}`),
    escapeCsv(product.itemType),
    escapeCsv(product.purity),
    escapeCsv(product.gender),
    escapeCsv(product.size || 'DEFAULT'),
    escapeCsv(product.grossWeightGrams || product.weightGrams || '0.000'),
    escapeCsv(product.otherWeightGrams || '0.000'),
    escapeCsv(product.netWeightGrams || product.grossWeightGrams || '0.000'),
    escapeCsv(heroFilename),
    escapeCsv(angle1Filename),
    escapeCsv(angle2Filename),
    escapeCsv(macroFilename),
    escapeCsv(tryonFilename),
    escapeCsv(product.staffName || 'Counter Staff'),
    escapeCsv(product.overallStatus.toUpperCase()),
    escapeCsv(product.createdAt)
  ];

  return `${headers.join(',')}\n${row.join(',')}`;
}

export function downloadCsvFile(product: ProductRecord): void {
  const csv = generateErpCsv(product);
  const cpc = product.cpc?.trim() || product.sku?.trim() || 'PRODUCT';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${cpc}_erp_data.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Audit Log localStorage helpers
const AUDIT_STORAGE_KEY = 'rl_jewels_audit_log_v2';

export function getStoredAuditLogs(): AuditLogItem[] {
  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load audit logs:', e);
    return [];
  }
}

export function saveAuditLogEntry(product: ProductRecord): void {
  try {
    const existing = getStoredAuditLogs();
    const approvedCount = product.photos.filter(p => p.reviewDecision === 'approved' || p.status === 'approved').length;
    const hasTryon = product.photos.some(p => Boolean(p.tryonImage));

    const entry: AuditLogItem = {
      id: product.id,
      sku: product.cpc || product.sku,
      cpc: product.cpc || product.sku,
      productName: product.name || `${product.purity} ${product.itemType}`,
      itemType: product.itemType,
      purity: product.purity,
      gender: product.gender,
      grossWeightGrams: product.grossWeightGrams || product.weightGrams || '0.000',
      otherWeightGrams: product.otherWeightGrams || '0.000',
      netWeightGrams: product.netWeightGrams || product.grossWeightGrams || '0.000',
      weightGrams: product.netWeightGrams || product.grossWeightGrams || '0.000',
      staffName: product.staffName,
      date: new Date().toISOString(),
      approvedPhotosCount: approvedCount,
      hasTryon,
      csvRow: generateErpCsv(product).split('\n')[1] || '',
      photosSummary: product.photos.map(p => ({
        slot: p.type,
        filename: `${product.cpc || product.sku}_${p.type}.jpg`,
        status: p.status,
        hasProcessed: Boolean(p.processedImage),
      })),
    };

    const updated = [entry, ...existing.filter(e => e.id !== product.id)].slice(0, 50);
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save audit log:', e);
  }
}
