import { describe, it, expect } from 'vitest';
import { escapeCsvValue, rowsToCsv, buildProductJsonLd } from '../export/csv';
import { validateMapping, applyMapping, type ErpMapping } from '../export/mappings';
import { buildExportRow, EXPORT_FIELDS } from '../export/fields';
import type { Product } from '../db/products';

const mapping: ErpMapping = {
  id: 'test',
  label: 'Test',
  columns: [
    { header: 'code', field: 'cpc' },
    { header: 'title', field: 'name' },
    { header: 'vendor', const: 'RL Jewels' },
  ],
};

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prd_1', batchId: null, cpc: 'RLJ-1', catalogProductId: '1',
    name: 'Test Ring', description: 'A ring.',
    seoMetaTitle: '', seoMetaDescription: '', seoKeywords: '',
    imageAltText: '', urlSlug: '', itemType: 'Ring', purity: '22kt',
    gender: "women's", size: 'DEFAULT',
    grossWeightGrams: '5.000', otherWeightGrams: '0.000', netWeightGrams: '4.800',
    status: 'approved', reviewNote: '', auditChecklist: null, auditReason: '',
    modelUsed: '', attemptCount: 1, estimatedCostUsd: 0.05,
    createdBy: 'usr_1', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', approvedAt: null, exportedAt: null,
    ...overrides,
  };
}

describe('escapeCsvValue', () => {
  it('leaves plain values alone', () => {
    expect(escapeCsvValue('Gold Ring')).toBe('Gold Ring');
  });

  it('quotes values containing a comma', () => {
    expect(escapeCsvValue('Ring, 22kt')).toBe('"Ring, 22kt"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCsvValue('The "best" ring')).toBe('"The ""best"" ring"');
  });

  it('quotes values containing newlines', () => {
    // A multi-line AI description must not break the row apart, which would
    // silently corrupt every subsequent column on import.
    expect(escapeCsvValue('Line one\nLine two')).toBe('"Line one\nLine two"');
  });

  it('handles an empty value', () => {
    expect(escapeCsvValue('')).toBe('');
  });
});

describe('rowsToCsv', () => {
  const row = buildExportRow({ product: makeProduct(), staffName: 'Anil' });

  it('emits a header row followed by one row per product', () => {
    const csv = rowsToCsv(mapping, [row, row], { bom: false });
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('code,title,vendor');
  });

  it('writes const columns into every row', () => {
    const csv = rowsToCsv(mapping, [row], { bom: false });
    expect(csv.split('\r\n')[1]).toBe('RLJ-1,Test Ring,RL Jewels');
  });

  it('prepends a UTF-8 BOM by default so Excel reads it as UTF-8', () => {
    expect(rowsToCsv(mapping, [row]).startsWith('﻿')).toBe(true);
    expect(rowsToCsv(mapping, [row], { bom: false }).startsWith('﻿')).toBe(false);
  });

  it('uses CRLF line endings', () => {
    expect(rowsToCsv(mapping, [row], { bom: false })).toContain('\r\n');
  });
});

describe('buildExportRow', () => {
  it('falls back to purity + item type when no name was generated', () => {
    const row = buildExportRow({ product: makeProduct({ name: '' }), staffName: 'Anil' });
    expect(row.name).toBe('22kt Ring');
  });

  it('falls back to gross weight when net weight is missing', () => {
    const row = buildExportRow({
      product: makeProduct({ netWeightGrams: '', grossWeightGrams: '7.250' }),
      staffName: 'Anil',
    });
    expect(row.netWeight).toBe('7.250');
  });

  it('substitutes a placeholder CPC rather than exporting an empty key', () => {
    const row = buildExportRow({ product: makeProduct({ cpc: '   ' }), staffName: 'Anil' });
    expect(row.cpc).toBe('RLJ-UNKNOWN');
  });

  it('populates every declared export field', () => {
    const row = buildExportRow({ product: makeProduct(), staffName: 'Anil' });
    for (const field of EXPORT_FIELDS) {
      expect(row[field], `field "${field}" is undefined`).toBeDefined();
    }
  });
});

describe('validateMapping', () => {
  it('accepts a well-formed mapping', () => {
    expect(validateMapping(mapping, 'test.json').id).toBe('test');
  });

  it('rejects a mapping with no columns', () => {
    expect(() => validateMapping({ id: 'x', columns: [] }, 'x.json')).toThrow(/non-empty/);
  });

  it('rejects a column referencing an unknown field', () => {
    // This is the guard that stops a typo in an operator-supplied mapping
    // from silently exporting a column of empty strings.
    expect(() =>
      validateMapping({ id: 'x', columns: [{ header: 'a', field: 'nonsense' }] }, 'x.json')
    ).toThrow(/unknown field/);
  });

  it('rejects a column with both field and const', () => {
    expect(() =>
      validateMapping({ id: 'x', columns: [{ header: 'a', field: 'cpc', const: 'y' }] }, 'x.json')
    ).toThrow(/exactly one/);
  });

  it('rejects a column with neither field nor const', () => {
    expect(() => validateMapping({ id: 'x', columns: [{ header: 'a' }] }, 'x.json')).toThrow(/exactly one/);
  });

  it('rejects duplicate headers', () => {
    expect(() =>
      validateMapping(
        { id: 'x', columns: [{ header: 'a', field: 'cpc' }, { header: 'a', field: 'name' }] },
        'x.json'
      )
    ).toThrow(/duplicate/);
  });
});

describe('applyMapping', () => {
  it('maps product fields onto ERP column headers', () => {
    const row = buildExportRow({ product: makeProduct(), staffName: 'Anil' });
    expect(applyMapping(mapping, row)).toEqual({
      code: 'RLJ-1',
      title: 'Test Ring',
      vendor: 'RL Jewels',
    });
  });
});

describe('buildProductJsonLd', () => {
  const row = buildExportRow({ product: makeProduct(), staffName: 'Anil' });

  it('omits offers, since this app tracks no price', () => {
    // Google's guidance is to omit incomplete offer data rather than publish
    // a placeholder price.
    expect(JSON.parse(buildProductJsonLd(row))).not.toHaveProperty('offers');
  });

  it('includes weight as a QuantitativeValue in grams', () => {
    expect(JSON.parse(buildProductJsonLd(row)).weight).toEqual({
      '@type': 'QuantitativeValue', value: '4.800', unitCode: 'GRM',
    });
  });

  it('omits a DEFAULT size rather than publishing it as a real size', () => {
    expect(JSON.parse(buildProductJsonLd(row))).not.toHaveProperty('size');
  });
});
