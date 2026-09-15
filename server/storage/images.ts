// Image storage on disk, referenced from the database by id.
//
// v1 kept every photo as a base64 data URL in React state and shipped it
// through 20MB JSON request bodies - original in, enhanced back out, per
// product. That works for a demo and falls over on a catalogue run: base64 is
// 33% larger than the bytes it encodes, nothing survives a tab close, and a
// tethered DSLR JPEG can exceed the body limit outright.
//
// Here the bytes hit disk once, and everything afterward passes a short id.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';
import { getDb, newId, nowIso } from '../db';

export type PhotoKind = 'original' | 'processed';
export type PhotoSource = 'upload' | 'phone_camera' | 'dslr' | 'sample';

export interface StoredPhoto {
  id: string;
  productId: string;
  kind: PhotoKind;
  filename: string;
  mimeType: string;
  bytes: number;
  source: PhotoSource;
  createdAt: string;
}

interface PhotoRow {
  id: string;
  product_id: string;
  kind: string;
  filename: string;
  mime_type: string;
  bytes: number;
  source: string;
  created_at: string;
}

function toStoredPhoto(row: PhotoRow): StoredPhoto {
  return {
    id: row.id,
    productId: row.product_id,
    kind: row.kind as PhotoKind,
    filename: row.filename,
    mimeType: row.mime_type,
    bytes: row.bytes,
    source: row.source as PhotoSource,
    createdAt: row.created_at,
  };
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export function extensionForMime(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType.toLowerCase()] || 'bin';
}

// Files are sharded into 256 subdirectories by the first byte of their id
// hash. A single flat directory holding ~7,000 files (3,247 products x
// original + processed) is slow to list on some filesystems and miserable to
// browse by hand when something needs checking.
function shardDir(photoId: string): string {
  const shard = crypto.createHash('sha1').update(photoId).digest('hex').slice(0, 2);
  return path.join(config.imageDir, shard);
}

export function absolutePathFor(photo: Pick<StoredPhoto, 'id' | 'filename'>): string {
  return path.join(shardDir(photo.id), photo.filename);
}

// Accepts either a bare base64 string or a full `data:image/jpeg;base64,...`
// URL, which is what browsers and the DSLR bridge both produce.
export function parseDataUrl(input: string): { mimeType: string; base64: string } {
  const match = input.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (match) return { mimeType: match[1], base64: match[2] };
  return { mimeType: 'image/jpeg', base64: input };
}

export function saveImage(input: {
  productId: string;
  kind: PhotoKind;
  data: string | Buffer;
  mimeType?: string;
  source?: PhotoSource;
}): StoredPhoto {
  let buffer: Buffer;
  let mimeType: string;

  if (Buffer.isBuffer(input.data)) {
    buffer = input.data;
    mimeType = input.mimeType || 'image/jpeg';
  } else {
    const parsed = parseDataUrl(input.data);
    buffer = Buffer.from(parsed.base64, 'base64');
    mimeType = input.mimeType || parsed.mimeType;
  }

  if (buffer.length === 0) {
    throw new Error('Refusing to store an empty image.');
  }

  const id = newId('img');
  const filename = `${id}.${extensionForMime(mimeType)}`;
  const dir = shardDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);

  const row: PhotoRow = {
    id,
    product_id: input.productId,
    kind: input.kind,
    filename,
    mime_type: mimeType,
    bytes: buffer.length,
    source: input.source || 'upload',
    created_at: nowIso(),
  };

  getDb()
    .prepare(
      `INSERT INTO photos (id, product_id, kind, filename, mime_type, bytes, source, created_at)
       VALUES (@id, @product_id, @kind, @filename, @mime_type, @bytes, @source, @created_at)`
    )
    .run(row);

  return toStoredPhoto(row);
}

export function getPhoto(photoId: string): StoredPhoto | null {
  const row = getDb().prepare('SELECT * FROM photos WHERE id = ?').get(photoId) as PhotoRow | undefined;
  return row ? toStoredPhoto(row) : null;
}

// Returns the newest photo of a kind for a product. Reshoots insert a new row
// rather than overwriting, so the original capture history stays intact and a
// bad "fix" can be walked back.
export function getLatestPhoto(productId: string, kind: PhotoKind): StoredPhoto | null {
  const row = getDb()
    .prepare('SELECT * FROM photos WHERE product_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(productId, kind) as PhotoRow | undefined;
  return row ? toStoredPhoto(row) : null;
}

export function listPhotos(productId: string): StoredPhoto[] {
  const rows = getDb()
    .prepare('SELECT * FROM photos WHERE product_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(productId) as PhotoRow[];
  return rows.map(toStoredPhoto);
}

export function readImageBuffer(photo: StoredPhoto): Buffer {
  return fs.readFileSync(absolutePathFor(photo));
}

export function readImageBase64(photo: StoredPhoto): string {
  return readImageBuffer(photo).toString('base64');
}

export function imageExists(photo: StoredPhoto): boolean {
  return fs.existsSync(absolutePathFor(photo));
}

// Removes a product's image files from disk. The photos rows themselves go
// with the product via ON DELETE CASCADE; this is the filesystem half, which
// no foreign key can do for us.
export function deleteImagesForProduct(productId: string): number {
  const photos = listPhotos(productId);
  let removed = 0;
  for (const photo of photos) {
    try {
      fs.unlinkSync(absolutePathFor(photo));
      removed++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Already gone is the desired end state, not a failure.
      if (code !== 'ENOENT') {
        console.warn(`[storage] could not delete ${photo.filename}: ${(err as Error).message}`);
      }
    }
  }
  return removed;
}

export function storageStats(): { photoCount: number; totalBytes: number } {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS total FROM photos')
    .get() as { n: number; total: number };
  return { photoCount: row.n, totalBytes: row.total };
}
