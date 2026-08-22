import React, { useEffect, useRef, useState } from 'react';
import { Camera, Upload, Trash2, CheckCircle2, Eye, Sparkles, AlertTriangle, Aperture, Focus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ZoomOut } from 'lucide-react';
import { PhotoItem, PreflightIssue } from '../types';
import { CameraModal } from './CameraModal';
import { downscaleImage, analyzeImageQuality, checkFlashFired } from '../utils/imagePreflight';
import { logClientEvent, isMobileUserAgent } from '../utils/analytics';

// How much tap-to-zoom magnifies the live view for a focus check - a fixed
// value rather than user-adjustable, since this is a quick "is it sharp"
// check, not a general zoom/pan tool.
const ZOOM_FACTOR = 2.5;

type FocusAction = 'af' | 'near-small' | 'near-large' | 'far-small' | 'far-large';

interface PhotoSlotCardProps {
  photo: PhotoItem;
  onUpdateImage: (dataUrl: string) => void;
  onRemoveImage: () => void;
  onLoadSample: () => void;
}

export const PhotoSlotCard: React.FC<PhotoSlotCardProps> = ({
  photo,
  onUpdateImage,
  onRemoveImage,
  onLoadSample,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [dslrAvailable, setDslrAvailable] = useState(false);
  const [isDslrCapturing, setIsDslrCapturing] = useState(false);
  const [dslrStage, setDslrStage] = useState('');
  const [dslrError, setDslrError] = useState('');
  const [liveViewFailed, setLiveViewFailed] = useState(false);
  const [focusAction, setFocusAction] = useState<FocusAction | null>(null);
  const [focusError, setFocusError] = useState('');
  const [zoom, setZoom] = useState<{ cx: number; cy: number } | null>(null);
  const [isMobile] = useState(() => isMobileUserAgent());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read inside the persistent live-stream effect below so toggling zoom
  // doesn't tear down and reconnect the stream (zoom isn't in that effect's
  // dependency array on purpose).
  const zoomRef = useRef<typeof zoom>(null);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    fetch('/api/dslr-capture/status')
      .then((res) => res.json())
      .then((d) => setDslrAvailable(Boolean(d?.available)))
      .catch(() => setDslrAvailable(false));
  }, []);

  // Both capture methods are reachable from either device (the DSLR endpoint
  // is just a normal API call, so a phone on the same network can trigger it
  // too) - this only decides which one is FEATURED as the default per
  // device. Someone on the station's laptop is standing at the lightbox, so
  // the studio camera is the obvious default there. Someone on their phone
  // is presumably not standing at the fixed station, so their own camera
  // stays the default - the studio camera is still one tap away if they are.
  const dslrIsPrimary = dslrAvailable && !isMobile;
  const dslrIsSecondaryOption = dslrAvailable && isMobile;

  // Fetch individual frames from the live-view stream and draw them on canvas.
  // Modern browsers dropped support for MJPEG in img tags, so we need to
  // parse the multipart stream manually and update canvas continuously.
  useEffect(() => {
    if (!dslrIsPrimary || liveViewFailed || isDslrCapturing) return;

    let controller: AbortController | null = null;
    let isActive = true;

    const startStream = async () => {
      try {
        controller = new AbortController();
        const res = await fetch('/api/dslr-capture/live', { signal: controller.signal });
        if (!res.ok || !res.body) {
          setLiveViewFailed(true);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = new Uint8Array(0);

        while (isActive) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer = new Uint8Array([...buffer, ...value]);

          // Look for JPEG frame boundaries in the multipart stream
          const startMarker = new Uint8Array([0xff, 0xd8]); // JPEG SOI
          const endMarker = new Uint8Array([0xff, 0xd9]); // JPEG EOI

          let startIdx = -1;
          for (let i = 0; i < buffer.length - 1; i++) {
            if (buffer[i] === startMarker[0] && buffer[i + 1] === startMarker[1]) {
              startIdx = i;
              break;
            }
          }

          if (startIdx === -1) continue;

          let endIdx = -1;
          for (let i = startIdx + 2; i < buffer.length - 1; i++) {
            if (buffer[i] === endMarker[0] && buffer[i + 1] === endMarker[1]) {
              endIdx = i + 2;
              break;
            }
          }

          if (endIdx === -1) continue;

          const jpegData = buffer.slice(startIdx, endIdx);
          const blob = new Blob([jpegData], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);

          // Draw on canvas - cropped to the zoomed region if tap-to-zoom is
          // active, full frame otherwise.
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.onload = () => {
              if (ctx) {
                const z = zoomRef.current;
                if (z) {
                  const sw = img.naturalWidth / ZOOM_FACTOR;
                  const sh = img.naturalHeight / ZOOM_FACTOR;
                  const sx = Math.min(Math.max(z.cx * img.naturalWidth - sw / 2, 0), img.naturalWidth - sw);
                  const sy = Math.min(Math.max(z.cy * img.naturalHeight - sh / 2, 0), img.naturalHeight - sh);
                  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
                } else {
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                }
              }
              URL.revokeObjectURL(url);
            };
            img.src = url;
          }

          // Remove processed bytes
          buffer = buffer.slice(endIdx);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Live view stream error:', err);
          setLiveViewFailed(true);
        }
      }
    };

    startStream();
    return () => {
      isActive = false;
      controller?.abort();
    };
  }, [dslrIsPrimary, liveViewFailed, isDslrCapturing]);

  const runPreflight = async (dataUrl: string, sourceFile?: File, method: 'in-app-camera' | 'gallery-upload' | 'dslr-capture' = 'in-app-camera') => {
    const isRetake = Boolean(photo.originalImage);
    const originalBytesApprox = Math.round((dataUrl.length * 3) / 4);
    setIsChecking(true);
    try {
      const downscaled = await downscaleImage(dataUrl);
      onUpdateImage(downscaled);
      const downscaledBytesApprox = Math.round((downscaled.length * 3) / 4);

      const [quality, flashFired] = await Promise.all([
        analyzeImageQuality(downscaled),
        sourceFile ? checkFlashFired(sourceFile) : Promise.resolve(null),
      ]);
      const issues = [...quality.issues];
      if (flashFired) {
        issues.unshift({
          code: 'flash_fired',
          message: 'Flash appears to have fired - this often blows out highlights on polished gold. Consider retaking with flash off.',
        });
      }
      setPreflightIssues(issues);
      logClientEvent('capture_completed', {
        method,
        isRetake,
        issueCodes: issues.map((i) => i.code),
        originalBytesApprox,
        downscaledBytesApprox,
      });
      if (isRetake) logClientEvent('retake', { method });
    } finally {
      setIsChecking(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        runPreflight(event.target.result, file, 'gallery-upload');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCameraCapture = (dataUrl: string) => {
    runPreflight(dataUrl);
  };

  const handleDslrCapture = async () => {
    setDslrError('');
    setZoom(null); // back to full frame once a real capture is taken
    setIsDslrCapturing(true);
    setDslrStage('Firing shutter…');
    // The bridge/camera round trip is a single blocking request with no
    // real intermediate progress signal from the hardware, so these stage
    // labels are timed estimates (calibrated against real captures), not
    // live status - good enough to keep the wait from feeling frozen.
    // Recalibrated against real bridge.log data from the studio rig (Canon
    // 7D + Lenovo, USB 2.0): digiCamControl's own shutter+transfer step
    // alone consistently runs 8.7-9.9s, so "Uploading" shouldn't claim to
    // start until that's essentially done.
    const stageTimers = [
      setTimeout(() => setDslrStage('Transferring from camera…'), 1200),
      setTimeout(() => setDslrStage('Uploading to studio…'), 9200),
    ];
    try {
      const res = await fetch('/api/dslr-capture', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Studio camera capture failed.');
      }
      await runPreflight(data.imageBase64, undefined, 'dslr-capture');
    } catch (err: any) {
      setDslrError(err?.message || 'Studio camera capture failed. Check the camera is connected and try again.');
    } finally {
      stageTimers.forEach(clearTimeout);
      setDslrStage('');
      setIsDslrCapturing(false);
    }
  };

  const handleAutofocus = async () => {
    setFocusError('');
    setFocusAction('af');
    try {
      const res = await fetch('/api/dslr-capture/focus', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Studio camera autofocus failed.');
      }
    } catch (err: any) {
      setFocusError(err?.message || 'Studio camera autofocus failed.');
    } finally {
      setFocusAction(null);
    }
  };

  const handleFocusNudge = async (direction: 'near' | 'far', amount: 'small' | 'large') => {
    setFocusError('');
    setFocusAction(`${direction}-${amount}` as FocusAction);
    try {
      const res = await fetch('/api/dslr-capture/focus/nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, amount }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Studio camera focus nudge failed.');
      }
    } catch (err: any) {
      setFocusError(err?.message || 'Studio camera focus nudge failed.');
    } finally {
      setFocusAction(null);
    }
  };

  // Tap-to-zoom on the live view for a quick "is it actually sharp" check.
  // Tapping again (or the reset badge) zooms back out. Accounts for
  // object-contain letterboxing so the zoomed region is centered on where
  // staff actually tapped, not a naive fraction of the element's box.
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const canvasAspect = canvas.width / canvas.height;
    const rectAspect = rect.width / rect.height;
    let contentWidth = rect.width;
    let contentHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;
    if (rectAspect > canvasAspect) {
      contentWidth = rect.height * canvasAspect;
      offsetX = (rect.width - contentWidth) / 2;
    } else {
      contentHeight = rect.width / canvasAspect;
      offsetY = (rect.height - contentHeight) / 2;
    }
    const clickX = e.clientX - rect.left - offsetX;
    const clickY = e.clientY - rect.top - offsetY;
    if (clickX < 0 || clickY < 0 || clickX > contentWidth || clickY > contentHeight) return;
    setZoom((prev) => (prev ? null : { cx: clickX / contentWidth, cy: clickY / contentHeight }));
  };

  const hasImage = Boolean(photo.originalImage);

  return (
    <div
      className={`rounded-2xl border transition-all ${
        hasImage ? 'bg-white border-red-200 shadow-xs' : 'bg-white border-stone-200 hover:border-stone-300'
      } p-4 sm:p-5 flex flex-col justify-between`}
    >
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm sm:text-base text-stone-900">{photo.title}</span>
            <span className="text-[10px] uppercase font-bold bg-red-50 text-red-700 px-2 py-0.5 rounded-full border border-red-200">
              Required
            </span>
          </div>
          <p className="text-xs text-stone-500 mt-1 leading-snug">
            One decent counter shot - flash off, fill the frame, avoid direct glare. The studio does the rest.
          </p>
        </div>

        {hasImage && (
          <div className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full text-xs font-semibold shrink-0 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Captured</span>
          </div>
        )}
      </div>

      <div className="relative aspect-square sm:aspect-video w-full rounded-xl overflow-hidden bg-stone-50 border border-stone-200 flex items-center justify-center my-1.5">
        {hasImage ? (
          <>
            <img src={photo.originalImage} alt={photo.title} className="w-full h-full object-contain" />
            <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowPreviewModal(true)}
                className="p-2 rounded-xl bg-white text-stone-800 hover:text-red-600 shadow-md transition-colors"
                title="Zoom View"
              >
                <Eye className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  onRemoveImage();
                  setPreflightIssues([]);
                }}
                className="p-2 rounded-xl bg-white text-red-600 hover:text-red-800 shadow-md transition-colors"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : dslrIsPrimary && !liveViewFailed ? (
          <>
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              onClick={handleCanvasClick}
              className="w-full h-full object-contain bg-stone-900 cursor-zoom-in"
            />
            <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full pointer-events-none">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span>Live</span>
            </div>
            {zoom && (
              <button
                type="button"
                onClick={() => setZoom(null)}
                className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 hover:bg-black/75 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full transition-colors"
                title="Reset Zoom"
              >
                <ZoomOut className="w-3 h-3" />
                <span>{ZOOM_FACTOR}× — tap to reset</span>
              </button>
            )}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60 rounded-full px-1.5 py-1.5">
              <button
                type="button"
                onClick={() => handleFocusNudge('near', 'large')}
                disabled={focusAction !== null || isDslrCapturing}
                className="p-1.5 rounded-full hover:bg-white/15 disabled:opacity-60 text-white transition-colors"
                title="Focus Near (Large Step)"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleFocusNudge('near', 'small')}
                disabled={focusAction !== null || isDslrCapturing}
                className="p-1.5 rounded-full hover:bg-white/15 disabled:opacity-60 text-white transition-colors"
                title="Focus Near (Small Step)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleAutofocus}
                disabled={focusAction !== null || isDslrCapturing}
                className="flex items-center gap-1 bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-full transition-colors"
                title="Autofocus"
              >
                <Focus className={`w-3.5 h-3.5 ${focusAction === 'af' ? 'animate-spin' : ''}`} />
                <span>{focusAction === 'af' ? 'Focusing…' : 'Focus'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleFocusNudge('far', 'small')}
                disabled={focusAction !== null || isDslrCapturing}
                className="p-1.5 rounded-full hover:bg-white/15 disabled:opacity-60 text-white transition-colors"
                title="Focus Far (Small Step)"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleFocusNudge('far', 'large')}
                disabled={focusAction !== null || isDslrCapturing}
                className="p-1.5 rounded-full hover:bg-white/15 disabled:opacity-60 text-white transition-colors"
                title="Focus Far (Large Step)"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="text-center p-4 flex flex-col items-center justify-center space-y-2">
            <div className="w-11 h-11 rounded-full bg-white border border-stone-200 flex items-center justify-center text-stone-500 shadow-xs">
              <Camera className="w-5 h-5 text-red-600" />
            </div>
            <span className="text-xs text-stone-500 font-medium">
              {dslrIsPrimary && liveViewFailed ? 'Studio camera live view unavailable' : 'Ready for Counter Camera'}
            </span>
          </div>
        )}
      </div>

      {isDslrCapturing && (
        <div className="text-[11px] text-stone-400 text-center py-1">{dslrStage || 'Capturing from studio camera…'}</div>
      )}

      {isChecking && (
        <div className="text-[11px] text-stone-400 text-center py-1">Checking photo quality…</div>
      )}

      {dslrError && (
        <div className="mt-1 mb-1 bg-red-50 border border-red-200 text-red-800 text-[11px] px-3 py-2 rounded-xl flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
          <span>{dslrError}</span>
        </div>
      )}

      {focusError && (
        <div className="mt-1 mb-1 bg-red-50 border border-red-200 text-red-800 text-[11px] px-3 py-2 rounded-xl flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
          <span>{focusError}</span>
        </div>
      )}

      {!isChecking && preflightIssues.length > 0 && (
        <div className="mt-1 mb-1 space-y-1.5">
          {preflightIssues.map((issue, idx) => (
            <div
              key={idx}
              className="bg-amber-50 border border-amber-200 text-amber-900 text-[11px] px-3 py-2 rounded-xl flex items-start gap-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 pt-2.5 border-t border-stone-100 flex items-center gap-2">
        {hasImage ? (
          <div className="w-full flex items-center gap-2">
            {dslrIsPrimary && (
              <button
                type="button"
                onClick={handleDslrCapture}
                disabled={isDslrCapturing}
                className="min-h-[44px] flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors uppercase tracking-wider"
              >
                <Aperture className="w-4 h-4" />
                <span>Retake (Studio Camera)</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCameraModal(true)}
              className={`min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors uppercase tracking-wider ${
                dslrIsPrimary
                  ? 'bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200'
                  : 'flex-1 bg-red-600 hover:bg-red-700 text-white'
              }`}
            >
              <Camera className={`w-4 h-4 ${dslrIsPrimary ? 'text-red-600' : 'text-white'}`} />
              <span>{dslrIsPrimary ? 'Phone' : 'Retake'}</span>
            </button>
            {dslrIsSecondaryOption && (
              <button
                type="button"
                onClick={handleDslrCapture}
                disabled={isDslrCapturing}
                className="min-h-[44px] px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-60 text-stone-700 border border-stone-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                title="Retake with Studio Camera"
              >
                <Aperture className="w-4 h-4" />
                <span className="hidden sm:inline">Studio</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onRemoveImage();
                setPreflightIssues([]);
                setDslrError('');
              }}
              className="min-h-[44px] min-w-[44px] py-2.5 px-3.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold border border-red-200 transition-colors flex items-center justify-center"
              title="Delete Photo"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="w-full flex flex-col sm:flex-row items-stretch gap-2">
            {dslrIsPrimary ? (
              <button
                type="button"
                onClick={handleDslrCapture}
                disabled={isDslrCapturing}
                className="min-h-[44px] flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs active:scale-95 transition-all"
              >
                <Aperture className="w-4 h-4 text-white" />
                <span>{isDslrCapturing ? 'Capturing…' : 'Capture from Studio Camera'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowCameraModal(true)}
                className="min-h-[44px] flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs active:scale-95 transition-all"
              >
                <Camera className="w-4 h-4 text-white" />
                <span>Camera Capture</span>
              </button>
            )}

            <div className="flex items-center gap-2 justify-center">
              {dslrIsPrimary && (
                <button
                  type="button"
                  onClick={() => setShowCameraModal(true)}
                  className="min-h-[44px] px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  title="Use Phone Camera Instead"
                >
                  <Camera className="w-4 h-4" />
                  <span className="hidden sm:inline">Phone</span>
                </button>
              )}

              {dslrIsSecondaryOption && (
                <button
                  type="button"
                  onClick={handleDslrCapture}
                  disabled={isDslrCapturing}
                  className="min-h-[44px] px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-60 text-stone-700 border border-stone-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  title="Use Studio Camera Instead"
                >
                  <Aperture className="w-4 h-4" />
                  <span className="hidden sm:inline">Studio</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (fileInputRef.current) fileInputRef.current.click();
                }}
                className="min-h-[44px] px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                title="Browse Gallery"
              >
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">Upload</span>
              </button>

              <button
                type="button"
                onClick={onLoadSample}
                className="min-h-[44px] px-3.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold flex items-center gap-1.5 transition-colors"
                title="Load Demo Sample"
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span className="hidden sm:inline">Sample</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <CameraModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        onCapture={handleCameraCapture}
        title={`Capture: ${photo.title}`}
      />

      {showPreviewModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowPreviewModal(false)}
        >
          <div className="relative max-w-2xl max-h-[85vh] bg-white rounded-2xl p-3 border border-stone-200 shadow-2xl">
            <img src={photo.originalImage} alt={photo.title} className="max-w-full max-h-[75vh] object-contain rounded-xl" />
            <div className="text-center py-2 text-xs text-stone-600 font-medium">
              {photo.title} • Tap anywhere to close
            </div>
          </div>
        </div>
      )}
    </div>
  );
};