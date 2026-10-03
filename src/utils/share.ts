// Sharing a finished product from the phone: the system share sheet carries the
// photo to WhatsApp, Instagram or anything else installed. The caption is put on
// the clipboard first, because Instagram ignores the text a share sheet passes
// it - staff paste it in.

export type ShareOutcome = 'shared' | 'cancelled' | 'saved';

async function fetchPhotoFile(url: string, baseName: string): Promise<File> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Could not load the photo.');
  const blob = await res.blob();
  const ext = blob.type.includes('png') ? 'png' : 'jpg';
  const safe = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'rl-jewels';
  return new File([blob], `${safe}.${ext}`, { type: blob.type || 'image/jpeg' });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Opens the share sheet with the photo and caption; where files cannot be shared, saves the photo instead. */
export async function shareProduct(opts: { photoUrl: string; name: string; caption: string }): Promise<ShareOutcome> {
  const file = await fetchPhotoFile(opts.photoUrl, opts.name);
  await copyText(opts.caption);
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text: opts.caption, title: opts.name });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  saveFile(file);
  return 'saved';
}

export function saveFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function savePhoto(photoUrl: string, name: string): Promise<void> {
  saveFile(await fetchPhotoFile(photoUrl, name));
}

export const whatsappTextUrl = (caption: string) => `https://wa.me/?text=${encodeURIComponent(caption)}`;
