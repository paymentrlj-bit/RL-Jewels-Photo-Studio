// Talks to the "RL Jewels CPC Master Data" Google Sheet - the durable,
// staff-editable source of truth for every CPC number and what it means
// (see cpcMaster.ts). Reuses the exact OAuth credentials already set up
// for Drive photo export (driveExport.ts, see DRIVE_SETUP.md) - no
// separate setup. The Sheets API accepts the same drive.file-equivalent
// scope for any spreadsheet this app creates itself, which is exactly how
// the sheet comes to exist (ensureCpcSheet() below creates it on first
// use if it isn't there yet).
//
// This module only knows about raw string[][] rows - it has no idea what
// a CPC or a ProductId is. cpcMaster.ts owns that mapping, keeping the
// Sheets-API mechanics here fully generic and reusable if this app ever
// needs a second small Sheet-backed table.

import { getAccessToken, isDriveConfigured } from './driveExport';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const SHEET_TITLE = 'RL Jewels CPC Master Data';
const TAB_NAME = 'CPCData';
const COLUMN_COUNT = 9; // A through I - keep in sync with cpcMaster.ts's CSV_COLUMNS
const DATA_RANGE = `${TAB_NAME}!A:I`;

let cachedSheetId: string | null = null;

async function findExistingSheetId(accessToken: string, rootFolderId: string): Promise<string | null> {
  const escapedName = SHEET_TITLE.replace(/'/g, "\\'");
  const query = `name='${escapedName}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const res = await fetch(`${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Failed to search Drive for the CPC master Sheet.');
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function createSheet(accessToken: string, rootFolderId: string): Promise<string> {
  const createRes = await fetch(SHEETS_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: SHEET_TITLE },
      sheets: [{ properties: { title: TAB_NAME } }],
    }),
  });
  const createData: any = await createRes.json();
  if (!createRes.ok || !createData.spreadsheetId) {
    throw new Error(createData.error?.message || 'Failed to create the CPC master Sheet.');
  }
  const spreadsheetId: string = createData.spreadsheetId;

  // The Sheets API always creates in "My Drive" root - move it into the
  // shared folder so it lives alongside the photo-export output instead of
  // scattered wherever the authorized account's Drive root happens to be.
  const moveRes = await fetch(`${DRIVE_FILES_URL}/${spreadsheetId}?addParents=${rootFolderId}&fields=id,parents`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!moveRes.ok) {
    console.warn(`Created the CPC master Sheet but could not move it into GOOGLE_DRIVE_ROOT_FOLDER_ID - it's in the authorized account's own Drive root instead (spreadsheetId: ${spreadsheetId}).`);
  }
  return spreadsheetId;
}

export interface CpcSheetHandle {
  spreadsheetId: string;
  isNew: boolean;
}

// Finds the CPC master Sheet in the shared root folder, creating it (empty,
// just the tab) if this is the very first run. Cached in-process - only
// hits the Drive search API once per server lifetime.
export async function ensureCpcSheet(): Promise<CpcSheetHandle> {
  if (!isDriveConfigured()) throw new Error('Google Drive is not configured on this server (GOOGLE_DRIVE_* env vars).');
  if (cachedSheetId) return { spreadsheetId: cachedSheetId, isNew: false };

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
  const accessToken = await getAccessToken();
  const existingId = await findExistingSheetId(accessToken, rootFolderId);
  if (existingId) {
    cachedSheetId = existingId;
    return { spreadsheetId: existingId, isNew: false };
  }
  const newId = await createSheet(accessToken, rootFolderId);
  cachedSheetId = newId;
  return { spreadsheetId: newId, isNew: true };
}

// Reads every row currently in the sheet, header row included (callers
// skip it) - a single request. Fine at this dataset's size (~40k rows);
// revisit if the sheet ever grows an order of magnitude larger.
export async function readAllRows(spreadsheetId: string): Promise<string[][]> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(DATA_RANGE)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Failed to read the CPC master Sheet (HTTP ${res.status}).`);
  return data.values || [];
}

const SEED_CHUNK_SIZE = 5000; // rows per request - keeps each request small and well under any Sheets API size/rate limit

// One-time bulk write used only to seed a freshly-created (empty) Sheet
// from the bundled data/cpc-master.csv. Chunked, not one giant request -
// ~40k rows in 8 sequential requests, comfortably inside Sheets' default
// per-minute write quota.
export async function seedSheet(spreadsheetId: string, header: string[], rows: string[][]): Promise<void> {
  const accessToken = await getAccessToken();
  const allRows = [header, ...rows];
  for (let i = 0; i < allRows.length; i += SEED_CHUNK_SIZE) {
    const chunk = allRows.slice(i, i + SEED_CHUNK_SIZE);
    const startRow = i + 1; // 1-indexed
    const endRow = i + chunk.length;
    const lastCol = String.fromCharCode('A'.charCodeAt(0) + COLUMN_COUNT - 1);
    const range = `${TAB_NAME}!A${startRow}:${lastCol}${endRow}`;
    const res = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: chunk }),
    });
    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      throw new Error(data.error?.message || `Failed to seed CPC master Sheet rows ${startRow}-${endRow} (HTTP ${res.status}).`);
    }
  }
}

// Appends one new row after the last used row - used for each individual
// newly-learned CPC. Sheets' own append semantics (finding the next empty
// row at write time) make this reasonably safe under light concurrency
// without this app needing to track row positions itself.
export async function appendRow(spreadsheetId: string, row: string[]): Promise<void> {
  const accessToken = await getAccessToken();
  const res = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(DATA_RANGE)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ majorDimension: 'ROWS', values: [row] }),
    }
  );
  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Failed to append a row to the CPC master Sheet (HTTP ${res.status}).`);
  }
}
