import { JWT } from 'google-auth-library';

// Uploads approved product photos + metadata into the store's own Google
// Drive via a service account - no Google Workspace required. The service
// account itself has almost no storage of its own; instead, share a regular
// Drive folder with the service account's email (like sharing with a
// colleague) and grant it Editor access. Everything the service account
// creates inside that shared folder counts against the real Drive owner's
// storage and appears in their Drive immediately - this is what makes it
// work on a plain personal/business Gmail account. See DRIVE_SETUP.md for
// the exact console steps.
//
// Scoped to drive.file (not full drive access) - this app can only see and
// manage files it creates itself, nothing else in the connected Drive.

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

let cachedClient: JWT | null = null;

function getServiceAccountCredentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isDriveConfigured(): boolean {
  return Boolean(getServiceAccountCredentials() && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
}

async function getAccessToken(): Promise<string> {
  const creds = getServiceAccountCredentials();
  if (!creds) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured.');

  if (!cachedClient) {
    cachedClient = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
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
