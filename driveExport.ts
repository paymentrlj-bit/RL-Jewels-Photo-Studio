import { OAuth2Client } from 'google-auth-library';

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
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export function isDriveConfigured(): boolean {
  return Boolean(getOAuthCredentials() && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
}

async function getAccessToken(): Promise<string> {
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

// Finds a folder by exact name under a given parent, creating it if it
// doesn't exist yet. Used to build a Group/Item-Type folder structure inside
// the shared root folder on first use of each category.
async function findOrCreateFolder(accessToken: string, name: string, parentId: string): Promise<string> {
  const escapedName = name.replace(/'/g, "\\'");
  const query = `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(`${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const searchData: any = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
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
  return createData.id;
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
  photoBase64: string; // data URL
  photoMimeType: string;
  metadataCsv: string;
}

export async function exportProductToDrive(input: DriveExportInput): Promise<{ folderLink: string; photoLink: string }> {
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured.');

  const accessToken = await getAccessToken();
  const categoryFolderName = (input.itemType || 'Uncategorized').trim() || 'Uncategorized';
  const categoryFolderId = await findOrCreateFolder(accessToken, categoryFolderName, rootFolderId);

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
