import { OAuth2Client } from 'google-auth-library';
import { config, isDriveConfigured as configuredInEnv } from '../config';
import { resolveCategory, genderVariesFor, groupFor } from '../catalog/taxonomy';

// Uploads approved product photos + metadata into the store's own Google
// Drive, authenticated as a real Google account via OAuth (not a service
// account) - no Google Workspace required. Service accounts have no Drive
// storage quota of their own, and Google only offers two ways around that
// (Shared Drives, domain-wide delegation) - both of which require a paid
// Workspace subscription. Authenticating as a real personal/business Gmail
// account sidesteps that entirely: uploads count against that account's
// normal Drive storage, same as if you'd dragged the file in yourself. See
// DRIVE_SETUP.md for the one-time authorization steps.
//
// Scoped to drive.file (not full drive access) - this app can only see and
// manage files it creates itself, nothing else in the connected Drive.

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

let cachedClient: OAuth2Client | null = null;

function getOAuthCredentials(): { clientId: string; clientSecret: string; refreshToken: string } | null {
  const { clientId, clientSecret, refreshToken } = config.drive;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export function isDriveConfigured(): boolean {
  return configuredInEnv();
}

// Exported so cpcSheet.ts can reuse this same cached OAuth2Client/token
// instead of maintaining a second one - both modules authenticate as the
// same Google account under the same drive.file-equivalent scope.
export async function getAccessToken(): Promise<string> {
  const creds = getOAuthCredentials();
  if (!creds) throw new Error('Google Drive OAuth credentials are not configured.');

  if (!cachedClient) {
    cachedClient = new OAuth2Client(creds.clientId, creds.clientSecret);
    cachedClient.setCredentials({ refresh_token: creds.refreshToken });
  }
  const { token } = await cachedClient.getAccessToken();
  if (!token) throw new Error('Could not obtain a Google Drive access token.');
  return token;
}

function normalizeFolderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Folder ids resolved during one export click, keyed by parentId + name.
 * Without this, a batch of 20 Rings re-searched Drive for the exact same
 * "Ring / Women's / Cocktail Ring" folder 20 times instead of once - most of
 * a Drive export's wall-clock time was this redundant searching, not the
 * actual file uploads.
 */
export type FolderCache = Map<string, string>;
export function newFolderCache(): FolderCache {
  return new Map();
}

// The drive-export worker (server/queue/driveExportWorker.ts) processes one
// job at a time for the lifetime of the server process, not one batch at a
// time - a scoped-per-request cache would only help products that happen to
// land in the same POST. This one instance is shared across every job the
// worker ever runs, so the speed win applies across separate export clicks
// too, not just within one. A folder id only goes stale if someone deletes
// that folder from Drive by hand, in which case the next upload to it fails
// with a clear "not found" error (surfaced per-item, same as any other
// failure) rather than silently going anywhere wrong - an acceptable trade
// for not re-searching Drive on every single upload for the server's whole
// uptime.
export const sharedFolderCache: FolderCache = newFolderCache();

// Finds a folder under a given parent, creating it if it doesn't exist yet.
// Used to build the Category/Gender/Style folder structure inside the
// shared root folder on first use of each.
//
// Matches case- and whitespace-insensitively, comparing every existing
// child rather than asking Drive's API to filter by exact name=. That
// exact-match query is why the same style typed as "Chandrakanta" once and
// "CHANDRAKANTA" (or with a trailing space) another time silently created
// TWO folders instead of reusing one - Drive's name= filter is case
// sensitive, so the second upload's search for its own exact string never
// found the first upload's folder. Comparing normalized names here means
// only a genuinely different name creates a new folder.
async function findOrCreateFolder(accessToken: string, name: string, parentId: string, cache: FolderCache): Promise<string> {
  const target = normalizeFolderName(name);
  const cacheKey = `${parentId}::${target}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const query = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(`${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1000`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const searchData: any = await searchRes.json();
  const existing = (searchData.files || []).find((f: any) => normalizeFolderName(f.name) === target);
  if (existing) {
    cache.set(cacheKey, existing.id);
    return existing.id;
  }

  const createRes = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  const createData: any = await createRes.json();
  if (!createData.id) {
    throw new Error(createData.error?.message || 'Failed to create Drive folder.');
  }
  cache.set(cacheKey, createData.id);
  return createData.id;
}

// Walks/creates a chain of nested folders, root first, returning the
// innermost folder's id. One find-or-create call per level - cheap once a
// level exists (the search hits before any create is attempted, and is
// skipped entirely on a cache hit), and no worse than the old flat
// structure's single call on a repeat upload.
async function findOrCreateFolderPath(accessToken: string, segments: string[], rootId: string, cache: FolderCache): Promise<string> {
  let parentId = rootId;
  for (const segment of segments) {
    parentId = await findOrCreateFolder(accessToken, segment, parentId, cache);
  }
  return parentId;
}

const GENDER_LABELS: Record<string, string> = {
  "women's": "Women's",
  "men's": "Men's",
  "kids'": "Kids'",
  unisex: 'Unisex',
};

// Drive folder names have no meaningful escaping needs beyond this - Drive
// itself accepts almost any character - but a stray slash would visually
// read as another path level, doubled-up spacing looks sloppy next to a
// folder typed cleanly the first time, and a very long style name (staff
// sometimes paste the full POS description) makes an unwieldy folder.
function cleanSegment(value: string, fallback: string): string {
  const cleaned = value.replace(/[/\\]/g, '-').trim().replace(/\s+/g, ' ').slice(0, 80);
  return cleaned || fallback;
}

/**
 * (Group, only for categories that share a merchandising department with
 * others) -> Category -> (Gender, only for categories that genuinely have
 * both) -> Style -> [product's files land here]. Replaces the old flat
 * "one folder per category" layout: at 3,000+ SKUs a single "Mangalsutra"
 * or "Chain" folder had become an unbrowsable wall of files, and everything
 * the split needs is already known at export time - nothing new to ask
 * staff for.
 *
 * Group is how the store itself shops these side by side - every ear-worn
 * style lands under "Earrings Category" whether it's a Jhumka, a Chandbali
 * or an Ear Chain, the same way a customer comparing earrings does not care
 * which of those trade names the piece happens to be. Not every category
 * has one: a few (Ring, Mangalsutra, Anklet...) are distinct enough on
 * their own that a department wrapper would only ever contain that one
 * folder.
 *
 * Style is the store's own raw style name (itemType as scanned/typed, e.g.
 * "Vati Mangalsutra", "Gents Casting Anguthi") - already the specific,
 * trade-language name staff use, no separate vocabulary needed. Falls back
 * to "General" when that name IS the category (staff typed just "Ring")
 * rather than nest a folder under itself for nothing.
 */
export function driveFolderSegments(itemType: string, gender: string): string[] {
  const category = resolveCategory(itemType);
  const segments: string[] = [];

  const group = category ? groupFor(itemType) : null;
  if (group) segments.push(group);

  // Unmatched item types get their own top-level bucket, not a folder named
  // after their raw text reused as its own style folder too - that would
  // nest e.g. "Something New/Something New" for nothing.
  segments.push(category ? category.type : 'Uncategorized');

  if (category && genderVariesFor(itemType)) {
    segments.push(GENDER_LABELS[gender] || 'Unspecified');
  }

  const raw = (itemType || '').trim();
  const isBareCategory = category !== null && raw.toLowerCase() === category.type.toLowerCase();
  segments.push(isBareCategory || !raw ? 'General' : cleanSegment(raw, 'General'));

  return segments;
}

async function uploadFile(
  accessToken: string,
  folderId: string,
  filename: string,
  mimeType: string,
  content: Buffer | string
): Promise<string> {
  const boundary = `rlj-${Date.now()}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const bodyContent = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;

  const multipartBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bodyContent,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });
  const data: any = await res.json();
  if (!data.id) {
    throw new Error(data.error?.message || 'Failed to upload file to Drive.');
  }
  return data.webViewLink || data.id;
}

export interface DriveExportInput {
  cpc: string;
  itemType: string;
  gender: string;
  photoBase64: string; // data URL
  photoMimeType: string;
  metadataCsv: string;
}

export async function exportProductToDrive(
  input: DriveExportInput,
  // Pass the SAME cache across every product in one export click (see
  // FolderCache above) - a fresh one per call defeats the point.
  folderCache: FolderCache = newFolderCache()
): Promise<{ folderLink: string; photoLink: string }> {
  const rootFolderId = config.drive.rootFolderId;
  if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured.');

  const accessToken = await getAccessToken();
  const categoryFolderId = await findOrCreateFolderPath(accessToken, driveFolderSegments(input.itemType, input.gender), rootFolderId, folderCache);

  const match = input.photoBase64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  const mimeType = match ? match[1] : input.photoMimeType || 'image/jpeg';
  const cleanBase64 = match ? match[2] : input.photoBase64;
  const ext = mimeType.includes('png') ? 'png' : 'jpg';

  const photoLink = await uploadFile(
    accessToken,
    categoryFolderId,
    `${input.cpc}_photo.${ext}`,
    mimeType,
    Buffer.from(cleanBase64, 'base64')
  );
  await uploadFile(accessToken, categoryFolderId, `${input.cpc}_data.csv`, 'text/csv', input.metadataCsv);

  const folderLink = `https://drive.google.com/drive/folders/${categoryFolderId}`;
  return { folderLink, photoLink };
}
