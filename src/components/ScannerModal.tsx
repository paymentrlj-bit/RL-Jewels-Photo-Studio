// QR / barcode scanner for the CPC on a physical tag.
//
// Built for speed on the counter: the phone's own barcode engine reads every
// camera frame (see utils/codeReader.ts), the stream asks for full HD with
// continuous focus, and the camera starts zoomed so staff can hold the phone
// far enough back for it to focus on a centimetre-wide code. The moment a
// code lands the phone buzzes, the camera turns off and the form fills in.
//
// If the live view cannot read a code - an old phone, a scuffed tag, or no
// HTTPS so no live camera at all - "Photograph the tag" takes a full
// resolution still with the phone's own camera app and reads that instead.

import React, { useEffect, useRef, useState } from 'react';
import { X, ScanLine, AlertCircle, Flashlight, Camera, ZoomIn } from 'lucide-react';
import { createCodeReader, type CodeReader } from '../utils/codeReader';
import { extractCpc } from '../../server/catalog/tagCode';
import { logClientEvent } from '../utils/analytics';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

// Past this, a hint appears: most failed scans are a phone held too close to
// focus, which a sentence fixes faster than anything else.
const HINT_AFTER_MS = 5000;

type ZoomRange = { min: number; max: number };

export const ScannerModal: React.FC<ScannerModalProps> = ({ isOpen, onClose, onScan }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const readerRef = useRef<CodeReader | null>(null);
  const openedAtRef = useRef(0);
  const doneRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'reading_photo' | 'done'>('starting');
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [zoom, setZoom] = useState(1);

  const liveCameraPossible = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== 'undefined' && window.isSecureContext;

  // Hands the code up exactly once, whichever path found it.
  const finish = (raw: string, via: 'live' | 'photo') => {
    if (doneRef.current) return;
    doneRef.current = true;
    const { cpc, matched } = extractCpc(raw);
    setLastCode(cpc);
    setStatus('done');
    trackRef.current?.stop();
    try { navigator.vibrate?.(60); } catch { /* not supported */ }
    logClientEvent('cpc_scanned', {
      via,
      reader: readerRef.current?.kind,
      msToScan: Date.now() - openedAtRef.current,
      matchedCpcPattern: matched,
      rawLength: raw.length,
      // A short sample, so the tag format can be confirmed from the logs.
      rawSample: raw.slice(0, 40),
    });
    onScan(cpc);
  };

  useEffect(() => {
    if (!isOpen) return;

    let stopped = false;
    let stream: MediaStream | null = null;
    doneRef.current = false;
    openedAtRef.current = Date.now();
    setError(null);
    setLastCode(null);
    setShowHint(false);
    setTorchOn(false);
    setTorchAvailable(false);
    setZoomRange(null);
    setStatus('starting');

    const hintTimer = window.setTimeout(() => setShowHint(true), HINT_AFTER_MS);

    const start = async () => {
      const reader = await createCodeReader();
      readerRef.current = reader;
      if (stopped || !liveCameraPossible) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            // Full HD: the tag QR is tiny, and every pixel across it counts.
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch (err) {
        const name = (err as Error)?.name;
        setError(
          name === 'NotAllowedError'
            ? 'Camera access is blocked. Allow the camera for this site in the browser settings, or use "Photograph the tag" below.'
            : name === 'NotReadableError'
              ? 'Another app is using the camera. Close it and try again, or use "Photograph the tag" below.'
              : 'Could not start the camera. Use "Photograph the tag" below instead.'
        );
        logClientEvent('scanner_error', { name, reader: reader.kind });
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        focusMode?: string[]; torch?: boolean; zoom?: { min: number; max: number };
      };
      const advanced: Record<string, unknown>[] = [];
      if (caps.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        // Start at 2x: close enough that the code fills the guide box from a
        // distance the lens can actually focus at.
        const initial = Math.min(caps.zoom.max, Math.max(caps.zoom.min, 2));
        advanced.push({ zoom: initial });
        setZoomRange({ min: caps.zoom.min, max: caps.zoom.max });
        setZoom(initial);
      }
      if (advanced.length > 0) {
        await track.applyConstraints({ advanced } as MediaTrackConstraints).catch(() => undefined);
      }
      setTorchAvailable(Boolean(caps.torch));
      setStatus('scanning');
      logClientEvent('scanner_opened', {
        reader: reader.kind,
        width: track.getSettings?.().width,
        height: track.getSettings?.().height,
        zoom: Boolean(caps.zoom),
        torch: Boolean(caps.torch),
      });

      // One read in flight at a time, as fast as frames arrive. Only a
      // CPC-shaped code (1516L387) is accepted - anything else (a price
      // barcode, a misread off the velvet's texture) is ignored and the
      // camera just keeps looking. The old scanner stopped on the first
      // thing it read at all, which is how a tag ended up filling the CPC
      // box with 411152 or 32382 instead of 1516L387: those were real reads
      // of *something* in the frame, just not the tag's own code.
      let misreadCount = 0;
      const tick = async () => {
        if (stopped || doneRef.current) return;
        if (video.readyState >= 2) {
          const text = await reader.readVideo(video);
          if (text && !stopped) {
            if (extractCpc(text).matched) {
              finish(text, 'live');
              return;
            }
            misreadCount++;
            // Reading plenty of something-but-not-a-CPC well before the
            // generic 5s hint is usually a focus problem, so surface the
            // hint sooner rather than making staff wait it out.
            if (misreadCount === 15) setShowHint(true);
          }
        }
        const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => void tick());
        else window.setTimeout(() => void tick(), 30);
      };
      void tick();
    };

    void start();

    return () => {
      stopped = true;
      window.clearTimeout(hintTimer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, [isOpen]);

  const toggleTorch = async () => {
    const next = !torchOn;
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  };

  const cycleZoom = async () => {
    if (!zoomRange) return;
    const steps = [1, 2, 3].map((z) => Math.min(zoomRange.max, Math.max(zoomRange.min, z)));
    const next = steps.find((z) => z > zoom + 0.01) ?? steps[0];
    await trackRef.current?.applyConstraints({ advanced: [{ zoom: next }] } as unknown as MediaTrackConstraints).catch(() => undefined);
    setZoom(next);
  };

  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setStatus('reading_photo');
    setError(null);
    try {
      const reader = readerRef.current ?? (await createCodeReader());
      readerRef.current = reader;
      const bitmap = await createImageBitmap(file);
      const text = await reader.readImage(bitmap);
      bitmap.close();
      if (text && extractCpc(text).matched) {
        finish(text, 'photo');
        return;
      }
      logClientEvent('scanner_photo_unreadable', {
        reader: reader.kind, bytes: file.size, readSomethingElse: Boolean(text),
      });
      setError(
        text
          ? 'That read something, but not the tag\'s CPC code. Get closer to the QR code and keep it sharp, or type the CPC.'
          : 'No code found in that photo. Fill the frame with the tag and keep it sharp, or type the CPC.'
      );
    } catch {
      setError('Could not read that photo. Try again, or type the CPC.');
    }
    setStatus(trackRef.current ? 'scanning' : 'starting');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl overflow-hidden w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-amber-700" />
            <h2 className="font-semibold text-stone-900">Scan the tag</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-stone-100" aria-label="Close scanner">
            <X className="w-5 h-5" />
          </button>
        </div>

        {liveCameraPossible && (
          <div className="relative bg-black aspect-[4/3]">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            {!error && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className={`w-1/2 aspect-square rounded-xl border-4 transition-colors ${status === 'done' ? 'border-emerald-400' : 'border-amber-400/90'}`} />
              </div>
            )}
            {(torchAvailable || zoomRange) && !error && (
              <div className="absolute bottom-3 right-3 flex gap-2">
                {zoomRange && (
                  <button
                    type="button"
                    onClick={() => void cycleZoom()}
                    className="flex min-h-[44px] items-center gap-1 rounded-full bg-black/60 px-3 text-sm font-medium text-white"
                    aria-label="Change zoom"
                  >
                    <ZoomIn className="w-4 h-4" /> {zoom.toFixed(zoom % 1 ? 1 : 0)}×
                  </button>
                )}
                {torchAvailable && (
                  <button
                    type="button"
                    onClick={() => void toggleTorch()}
                    className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full ${torchOn ? 'bg-amber-400 text-black' : 'bg-black/60 text-white'}`}
                    aria-label={torchOn ? 'Turn light off' : 'Turn light on'}
                  >
                    <Flashlight className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <div className="text-white">
                  <AlertCircle className="w-8 h-8 mx-auto mb-3 text-amber-400" />
                  <p className="text-sm">{error}</p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3 px-5 py-4 text-sm text-stone-600">
          {lastCode ? (
            <p className="font-medium text-emerald-700">Scanned {lastCode}</p>
          ) : status === 'reading_photo' ? (
            <p>Reading the code in that photo…</p>
          ) : liveCameraPossible ? (
            <p>
              Put the QR code inside the box.
              {showHint && ' Not reading? Move the phone a little further back so the code is sharp, or turn on the light.'}
            </p>
          ) : (
            <p>Take a close, sharp photo of the tag's QR code and it will be read from that.</p>
          )}
          {!liveCameraPossible && error && <p className="text-red-700">{error}</p>}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={status === 'reading_photo' || status === 'done'}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-800 hover:bg-stone-50 disabled:opacity-60"
          >
            <Camera className="w-4 h-4" /> Photograph the tag
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handlePhoto(e)} />
        </div>
      </div>
    </div>
  );
};
