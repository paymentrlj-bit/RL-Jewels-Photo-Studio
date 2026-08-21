import JSZip from 'jszip';
import { ProductRecord } from '../types';

/**
 * Creates and triggers download of a ZIP containing the approved product photo,
 * named by CPC, alongside the ERP import CSV.
 */
export async function downloadProductZip(product: ProductRecord): Promise<void> {
  const zip = new JSZip();
  const cpc = product.cpc?.trim() || product.sku?.trim() || 'PRODUCT';

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

  const imgData = product.photo.processedImage || product.photo.originalImage;
  if (imgData) {
    const filename = `${cpc}_photo.jpg`;
    zip.file(filename, dataUrlToBinary(imgData));
  }

  const csvContent = generateErpCsv(product);
  zip.file(`${cpc}_erp_import.csv`, csvContent);

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
 * Generates a structured CSV row for bulk ERP / inventory import.
 */
export function generateErpCsv(product: ProductRecord): string {
  const cpc = product.cpc?.trim() || product.sku?.trim() || 'RLJ-UNKNOWN';
  const hasPhoto = Boolean(product.photo.processedImage || product.photo.originalImage);
  const photoFilename = hasPhoto ? `${cpc}_photo.jpg` : '';

  const headers = [
    'CPC',
    'product_name',
    'product_description',
    // Named to match Odoo's website_sale SEO fields (website_meta_title,
    // website_meta_description, website_meta_keywords) so these columns can
    // be mapped directly on import instead of needing manual re-entry.
    'website_meta_title',
    'website_meta_description',
    'website_meta_keywords',
    'image_alt_text',
    'suggested_url_slug',
    'item_type',
    'gold_purity',
    'gender_category',
    'size',
    'gross_weight_grams',
    'other_weight_grams',
    'net_weight_grams',
    'photo_filename',
    'staff_member',
    'overall_status',
    'created_at',
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
    escapeCsv(product.description || ''),
    escapeCsv(product.seoMetaTitle || ''),
    escapeCsv(product.seoMetaDescription || ''),
    escapeCsv(product.seoKeywords || ''),
    escapeCsv(product.imageAltText || ''),
    escapeCsv(product.urlSlug || ''),
    escapeCsv(product.itemType),
    escapeCsv(product.purity),
    escapeCsv(product.gender),
    escapeCsv(product.size || 'DEFAULT'),
    escapeCsv(product.grossWeightGrams || product.weightGrams || '0.000'),
    escapeCsv(product.otherWeightGrams || '0.000'),
    escapeCsv(product.netWeightGrams || product.grossWeightGrams || '0.000'),
    escapeCsv(photoFilename),
    escapeCsv(product.staffName || 'Counter Staff'),
    escapeCsv(product.overallStatus.toUpperCase()),
    escapeCsv(product.createdAt),
  ];

  return `${headers.join(',')}\n${row.join(',')}`;
}

/**
 * Generates a schema.org Product JSON-LD snippet - the actual structured
 * data format Google reads for rich search results, distinct from the plain
 * SEO metadata columns in the CSV. Deliberately omits "offers" (price):
 * this app doesn't track live pricing, and Google's own guidance is to omit
 * incomplete offer data rather than publish a placeholder/fake price -
 * whoever adds this to the live product page needs to fill that in from the
 * real price at publish time.
 */
export function generateProductJsonLd(product: ProductRecord, imageUrl?: string): string {
  const purityLabel = product.purity ? `${product.purity} Gold` : 'Gold';
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.seoMetaTitle || product.name,
    description: product.seoMetaDescription || product.description || undefined,
    image: imageUrl || 'REPLACE_WITH_HOSTED_PRODUCT_PHOTO_URL',
    sku: product.cpc || product.sku,
    category: product.itemType,
    material: purityLabel,
    brand: { '@type': 'Brand', name: 'RL Jewels' },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Purity', value: product.purity },
      { '@type': 'PropertyValue', name: 'Gross Weight', value: `${product.grossWeightGrams || product.weightGrams || '0'}g` },
      { '@type': 'PropertyValue', name: 'Net Gold Weight', value: `${product.netWeightGrams || product.grossWeightGrams || '0'}g` },
      { '@type': 'PropertyValue', name: 'Gender', value: product.gender },
    ].filter((p) => p.value),
  };
  return JSON.stringify(jsonLd, null, 2);
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