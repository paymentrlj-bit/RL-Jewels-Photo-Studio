// "Retake": a fresh main photo for a piece that was sent back. Opens the phone's
// camera straight away and replaces the original - the piece goes back into the
// queue with priority, since someone is standing at the counter with it.
import React, { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { api, ApiError } from '../api';
import { downscaleImage } from '../utils/imagePreflight';
import { logClientEvent } from '../utils/analytics';

export const RetakeButton: React.FC<{
  productId: string;
  onDone: () => void;
  onError: (message: string) => void;
}> = ({ productId, onDone, onError }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      try {
        const scaled = await downscaleImage(String(reader.result), 2200, 0.92);
        await api.attachPhoto(productId, scaled, 'upload');
        logClientEvent('retake_sent', { productId });
        onDone();
      } catch (err) {
        onError(err instanceof ApiError ? err.message : 'Could not send that photo.');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        <Camera className="w-4 h-4" /> {busy ? 'Sending…' : 'Retake photo'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
    </>
  );
};
