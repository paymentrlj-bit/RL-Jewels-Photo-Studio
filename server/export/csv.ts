// CSV generation.
//
// Two changes from v1 worth knowing about:
//
// 1. v1 wrote one CSV per product, each with its own header row. Importing
//    400 products meant 400 files. Here a batch exports as one CSV with one
//    header and one row per product, which is what every ERP import actually
//    wants.
//
// 2. A UTF-8 BOM is prepended. Excel on Windows - which is what will open
//    these at the store - reads a BOM-less UTF-8 CSV as the local ANSI
//    codepage and mangles any non-ASCII character in a product name.

import { applyMapping, getMapping, type ErpMapping } from './mappings';
import type { ExportRow } from './fields';

const BOM = '﻿';

export function escapeCsvValue(value: string): string {
  const str = value ?? '';
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(mapping: ErpMapping, rows: ExportRow[], options: { bom?: boolean } = {}): string {
  const headers = mapping.columns.map((c) => c.header);
  const lines = [headers.map(escapeCsvValue).join(',')];

  for (const row of rows) {
    const mapped = applyMapping(mapping, row);
    lines.push(headers.map((h) => escapeCsvValue(mapped[h] ?? '')).join(','));
  }

  // CRLF: the line ending every spreadsheet on Windows expects.
  const body = lines.join('\r\n');
  return options.bom === false ? body : BOM + body;
}

export function buildCsv(mappingId: string, rows: ExportRow[]): { csv: string; mapping: ErpMapping } {
  const mapping = getMapping(mappingId);
  return { csv: rowsToCsv(mapping, rows), mapping };
}

// schema.org Product JSON-LD - the structured data Google reads for rich
// results, distinct from the plain SEO columns above.
//
// Deliberately omits "offers" (price): this app does not track live pricing,
// and Google's own guidance is to omit incomplete offer data rather than
// publish a placeholder. Whoever puts this on the live product page fills in
// the real price at publish time.
export function buildProductJsonLd(row: ExportRow, imageUrl?: string): string {
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: row.name,
    description: row.description,
    sku: row.cpc,
    brand: { '@type': 'Brand', name: 'RL Jewels' },
    material: `${row.purity} Gold`,
    category: row.itemType,
  };

  if (imageUrl) jsonLd.image = imageUrl;
  if (row.size && row.size !== 'DEFAULT') jsonLd.size = row.size;
  if (row.netWeight && row.netWeight !== '0.000') {
    jsonLd.weight = { '@type': 'QuantitativeValue', value: row.netWeight, unitCode: 'GRM' };
  }

  return JSON.stringify(jsonLd, null, 2);
}
