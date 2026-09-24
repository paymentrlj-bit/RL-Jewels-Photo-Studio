// "Add another angle": one more photo of a piece that is already queued, to
// show what the first photo hid. Opens the phone's own camera, like the main
// capture button, so it works over plain HTTP too.

import React, { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { api, ApiError } from '../api';
import { downscaleImage } from '../utils/imagePreflight';
import { logClientEvent } from '../utils/analytics';

interface AngleCaptureButtonProps {
  productId: string;
  onAdded: () => void;
  onError: (message: string) => void;
  label?: string;
}

export const AngleCaptureButton: React.FC<AngleCaptureButtonProps> = ({ productId, onAdded, onError, label = 'Add another angle' }) => {
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
        await api.addAngle(productId, scaled);
        logClientEvent('angle_added', { productId });
        onAdded();
      } catch (err) {
        onError(err instanceof ApiError ? err.message : 'Could not add that photo.');
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
        className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
      >
        <Camera className="w-4 h-4" /> {busy ? 'Uploading…' : label}
      </button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
    </>
  );
};
