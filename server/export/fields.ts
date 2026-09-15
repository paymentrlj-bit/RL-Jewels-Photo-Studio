// The flat, export-shaped view of a product: every value any ERP mapping is
// allowed to reference, computed once.
//
// Keeping this separate from the mappings means adding a new ERP is a matter
// of listing columns, not writing code that reaches into the database.

import type { Product } from '../db/products';

export const EXPORT_FIELDS = [
  'cpc',
  'catalogProductId',
  'name',
  'description',
  'metaTitle',
  'metaDescription',
  'metaKeywords',
  'imageAltText',
  'urlSlug',
  'itemType',
  'purity',
  'gender',
  'size',
  'grossWeight',
  'otherWeight',
  'netWeight',
  'photoFilename',
  'staffName',
  'status',
  'createdAt',
  'approvedAt',
  'batchName',
] as const;

export type ExportField = (typeof EXPORT_FIELDS)[number];

export type ExportRow = Record<ExportField, string>;

export function buildExportRow(input: {
  product: Product;
  staffName: string;
  batchName?: string;
  photoFilename?: string;
}): ExportRow {
  const { product } = input;
  const cpc = product.cpc.trim() || 'RLJ-UNKNOWN';

  return {
    cpc,
    catalogProductId: product.catalogProductId || '',
    // Falls back to a description built from the fields we do have, so a row
    // is never exported with an empty name because copy generation failed.
    name: product.name || `${product.purity} ${product.itemType}`.trim(),
    description: product.description,
    metaTitle: product.seoMetaTitle,
    metaDescription: product.seoMetaDescription,
    metaKeywords: product.seoKeywords,
    imageAltText: product.imageAltText,
    urlSlug: product.urlSlug,
    itemType: product.itemType,
    purity: product.purity,
    gender: product.gender,
    size: product.size || 'DEFAULT',
    grossWeight: product.grossWeightGrams || '0.000',
    otherWeight: product.otherWeightGrams || '0.000',
    netWeight: product.netWeightGrams || product.grossWeightGrams || '0.000',
    photoFilename: input.photoFilename || `${cpc}_photo.jpg`,
    staffName: input.staffName,
    status: product.status.toUpperCase(),
    createdAt: product.createdAt,
    approvedAt: product.approvedAt || '',
    batchName: input.batchName || '',
  };
}

export function isExportField(value: string): value is ExportField {
  return (EXPORT_FIELDS as readonly string[]).includes(value);
}
