import { getAccessToken, findOrCreateFolder, uploadFile, isDriveConfigured } from './driveExport';

// Golden-set regression infrastructure (PIPELINE_REBUILD_BRIEF.md Section 6).
//
// The brief calls for a fixed set of ~15-20 REAL photos - deliberately
// spanning thin chain, bead necklace, faceted stone, matte/brushed texture,
// mixed metal, and at least one tag-crossing case - with every phase's
// output on that same set saved so later phases can be diffed against
// earlier ones. Curating those specific real photos requires physically
// photographing real store jewelry and cannot be done here; what this module
// provides is the durable-storage mechanism an admin uses to save a given
// photo's result as a labeled golden-set baseline for a given phase, reusing
// the same shared Drive folder + OAuth setup already configured for photo
// export (DRIVE_SETUP.md) rather than local disk, which does not survive a
// redeploy on this app's ephemeral hosting.
//
// Fails open like every other Drive write in this app: if Drive isn't
// configured or the save fails, that's surfaced to the caller as a real
// error (the admin action itself, not a silent background pipeline step) -
// there's no "fine to lose this quietly" case here, since the whole point is
// a durable, trustworthy comparison baseline.

export function isGoldenSetConfigured(): boolean {
  return isDriveConfigured();
}

export interface SaveGoldenSetInput {
  phase: string; // e.g. "phase-1", "phase-2" - free text, not validated against a fixed enum since Section 6 phases may be renumbered
  label: string; // short human label for the case, e.g. "thin-chain-01" or "tag-crossing-01"
  originalImageBase64: string; // data URL
  processedImageBase64: string; // data URL
  metadata: Record<string, unknown>;
}

export interface SaveGoldenSetResult {
  folderLink: string;
}

function extractImage(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  const mimeType = match ? match[1] : 'image/jpeg';
  const cleanBase64 = match ? match[2] : dataUrl;
  return { mimeType, buffer: Buffer.from(cleanBase64, 'base64') };
}

export async function saveToGoldenSet(input: SaveGoldenSetInput): Promise<SaveGoldenSetResult> {
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured.');

  const accessToken = await getAccessToken();
  const goldenSetFolderId = await findOrCreateFolder(accessToken, 'Golden Set', rootFolderId);
  const phaseFolderName = (input.phase || 'unlabeled-phase').trim() || 'unlabeled-phase';
  const phaseFolderId = await findOrCreateFolder(accessToken, phaseFolderName, goldenSetFolderId);

  const safeLabel = (input.label || 'case').trim().replace(/[^a-zA-Z0-9-_]/g, '-') || 'case';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const caseFolderId = await findOrCreateFolder(accessToken, `${safeLabel}_${timestamp}`, phaseFolderId);

  const original = extractImage(input.originalImageBase64);
  const originalExt = original.mimeType.includes('png') ? 'png' : 'jpg';
  await uploadFile(accessToken, caseFolderId, `original.${originalExt}`, original.mimeType, original.buffer);

  const processed = extractImage(input.processedImageBase64);
  const processedExt = processed.mimeType.includes('png') ? 'png' : 'jpg';
  await uploadFile(accessToken, caseFolderId, `processed.${processedExt}`, processed.mimeType, processed.buffer);

  await uploadFile(
    accessToken,
    caseFolderId,
    'metadata.json',
    'application/json',
    JSON.stringify({ phase: input.phase, label: input.label, savedAt: new Date().toISOString(), ...input.metadata }, null, 2)
  );

  return { folderLink: `https://drive.google.com/drive/folders/${caseFolderId}` };
}
