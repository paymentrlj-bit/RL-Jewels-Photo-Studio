// ERP column mappings.
//
// v1 hardcoded its CSV headers to Odoo's website_sale field names
// (website_meta_title and friends). Nobody ever confirmed the store actually
// runs Odoo - it was an assumption baked into code, and if it is wrong then
// every export needs manual re-entry into whatever system they really use.
//
// Mappings are data here. Pointing this at the real ERP means writing a JSON
// file, not editing an export function. Drop a file into
// server/export/mappings/<name>.json and set ERP_MAPPING=<name>.
//
// A mapping file looks like:
//   {
//     "id": "tally",
//     "label": "Tally Prime item import",
//     "columns": [
//       { "header": "Item Name",  "field": "name" },
//       { "header": "Item Code",  "field": "cpc" },
//       { "header": "Unit",       "const": "Nos" }
//     ]
//   }

import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { isExportField, type ExportField, type ExportRow } from './fields';

export interface MappingColumn {
  header: string;
  // Exactly one of these. `field` pulls a value from the product; `const`
  // writes the same literal into every row (for columns an ERP requires but
  // this app has no concept of, like a warehouse code).
  field?: ExportField;
  const?: string;
}

export interface ErpMapping {
  id: string;
  label: string;
  description?: string;
  columns: MappingColumn[];
}

// Two places are searched, in this order, and a mapping in the data dir wins:
//
//   1. <DATA_DIR>/mappings  - the mounted volume. An operator can drop the
//      store's real ERP schema here and restart, with no rebuild and no
//      redeploy. This is the one that matters once the real ERP is known.
//   2. server/export/mappings - the presets that ship with the app.
//
// process.cwd() rather than __dirname deliberately: __dirname is undefined
// under tsx in an ESM package, and this has to resolve identically in dev and
// in the bundled production build.
const BUNDLED_MAPPINGS_DIR = path.join(process.cwd(), 'server', 'export', 'mappings');
const OPERATOR_MAPPINGS_DIR = path.join(config.dataDir, 'mappings');

// Built in rather than read from disk, so the app always has something valid
// to fall back on even if the mappings directory is missing entirely.
const GENERIC_MAPPING: ErpMapping = {
  id: 'generic',
  label: 'Generic catalogue CSV',
  description:
    'Every field this app knows about, with plain readable headers. Safe default until the store\'s real ERP schema is confirmed.',
  columns: [
    { header: 'cpc', field: 'cpc' },
    { header: 'catalog_product_id', field: 'catalogProductId' },
    { header: 'product_name', field: 'name' },
    { header: 'product_description', field: 'description' },
    { header: 'meta_title', field: 'metaTitle' },
    { header: 'meta_description', field: 'metaDescription' },
    { header: 'meta_keywords', field: 'metaKeywords' },
    { header: 'image_alt_text', field: 'imageAltText' },
    { header: 'url_slug', field: 'urlSlug' },
    { header: 'item_type', field: 'itemType' },
    { header: 'gold_purity', field: 'purity' },
    { header: 'gender_category', field: 'gender' },
    { header: 'size', field: 'size' },
    { header: 'gross_weight_grams', field: 'grossWeight' },
    { header: 'other_weight_grams', field: 'otherWeight' },
    { header: 'net_weight_grams', field: 'netWeight' },
    { header: 'photo_filename', field: 'photoFilename' },
    { header: 'staff_member', field: 'staffName' },
    { header: 'overall_status', field: 'status' },
    { header: 'created_at', field: 'createdAt' },
  ],
};

export function validateMapping(raw: unknown, sourceName: string): ErpMapping {
  const mapping = raw as Partial<ErpMapping>;
  if (!mapping || typeof mapping !== 'object') {
    throw new Error(`${sourceName}: not a JSON object.`);
  }
  if (!mapping.id || typeof mapping.id !== 'string') {
    throw new Error(`${sourceName}: missing a string "id".`);
  }
  if (!Array.isArray(mapping.columns) || mapping.columns.length === 0) {
    throw new Error(`${sourceName}: "columns" must be a non-empty array.`);
  }

  const seen = new Set<string>();
  for (const [index, column] of mapping.columns.entries()) {
    if (!column?.header || typeof column.header !== 'string') {
      throw new Error(`${sourceName}: column ${index} is missing a string "header".`);
    }
    if (seen.has(column.header)) {
      throw new Error(`${sourceName}: duplicate column header "${column.header}".`);
    }
    seen.add(column.header);

    const hasField = typeof column.field === 'string';
    const hasConst = typeof column.const === 'string';
    if (hasField === hasConst) {
      throw new Error(`${sourceName}: column "${column.header}" needs exactly one of "field" or "const".`);
    }
    if (hasField && !isExportField(column.field as string)) {
      throw new Error(
        `${sourceName}: column "${column.header}" references unknown field "${column.field}". ` +
        `See EXPORT_FIELDS in server/export/fields.ts for the list.`
      );
    }
  }

  return {
    id: mapping.id,
    label: mapping.label || mapping.id,
    description: mapping.description,
    columns: mapping.columns as MappingColumn[],
  };
}

function loadMappingsFrom(dir: string, into: Map<string, ErpMapping>): void {
  if (!fs.existsSync(dir)) return;

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const mapping = validateMapping(raw, file);
      into.set(mapping.id, mapping);
    } catch (err) {
      // A malformed mapping must be loud. Silently skipping it would mean
      // exports quietly fall back to the generic schema and land in the ERP
      // with the wrong headers, which is worse than an error at boot.
      console.error(`[export] ignoring mapping "${path.join(dir, file)}": ${(err as Error).message}`);
    }
  }
}

function loadMappingsFromDisk(): Map<string, ErpMapping> {
  const out = new Map<string, ErpMapping>();
  loadMappingsFrom(BUNDLED_MAPPINGS_DIR, out);
  // Loaded second so an operator-supplied file with the same id overrides the
  // shipped preset rather than the other way round.
  loadMappingsFrom(OPERATOR_MAPPINGS_DIR, out);
  return out;
}

let cache: Map<string, ErpMapping> | null = null;

export function allMappings(): ErpMapping[] {
  if (!cache) {
    cache = loadMappingsFromDisk();
    cache.set(GENERIC_MAPPING.id, GENERIC_MAPPING);
  }
  return [...cache.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function getMapping(id: string): ErpMapping {
  if (!cache) allMappings();
  const mapping = cache!.get(id);
  if (!mapping) {
    console.warn(`[export] ERP_MAPPING="${id}" not found - falling back to "generic".`);
    return GENERIC_MAPPING;
  }
  return mapping;
}

export function applyMapping(mapping: ErpMapping, row: ExportRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const column of mapping.columns) {
    out[column.header] = column.const !== undefined ? column.const : row[column.field as ExportField] ?? '';
  }
  return out;
}
