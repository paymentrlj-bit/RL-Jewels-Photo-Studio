import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, RefreshCw, AlertCircle, Sparkles } from 'lucide-react';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
  title: string;
}

const GUIDE_PREF_KEY = 'rl_jewels_camera_guide_enabled_v1';

type LiveReadout = { label: string; tone: 'good' | 'warn' } | null;

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onCapture,
  title,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [guideEnabled, setGuideEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GUIDE_PREF_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const [liveReadout, setLiveReadout] = useState<LiveReadout>(null);

  const toggleGuide = () => {
    setGuideEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(GUIDE_PREF_KEY, next ? 'on' : 'off');
      } catch {
        // ignore
      }
      if (!next) setLiveReadout(null);
      return next;
    });
  };

  // Live, in-viewfinder exposure/sharpness readout - samples the video feed
  // a couple times a second onto a small offscreen canvas, reusing the same
  // luminance/Laplacian-variance approach as the post-capture preflight
  // check, just at a smaller sample size so it stays smooth in real time.
  // Purely local (no network/API cost) - just an early nudge before the
  // shutter, not a replacement for the real preflight check after capture.
  useEffect(() => {
    if (!stream || !guideEnabled || error) {
      setLiveReadout(null);
      return;
    }
    if (!sampleCanvasRef.current) {
      sampleCanvasRef.current = document.createElement('canvas');
    }
    const size = 96;
    const canvas = sampleCanvasRef.current;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      const gray = new Float32Array(size * size);
      let darkCount = 0;
      let brightCount = 0;
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        gray[p] = lum;
        if (lum < 35) darkCount++;
        if (lum > 248) brightCount++;
      }
      const totalPx = size * size;

      if (darkCount / totalPx > 0.6) {
        setLiveReadout({ label: 'Too Dark - Add Light', tone: 'warn' });
        return;
      }
      if (brightCount / totalPx > 0.45) {
        setLiveReadout({ label: 'Glare / Overexposed', tone: 'warn' });
        return;
      }

      let edgeSum = 0;
      let edgeSumSq = 0;
      let edgeCount = 0;
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const idx = y * size + x;
          const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - size] - gray[idx + size];
          edgeSum += lap;
          edgeSumSq += lap * lap;
          edgeCount++;
        }
      }
      const mean = edgeSum / edgeCount;
      const variance = edgeSumSq / edgeCount - mean * mean;

      if (variance < 40) {
        setLiveReadout({ label: 'Hold Steady - Blurry', tone: 'warn' });
      } else {
        setLiveReadout({ label: 'Good Exposure & Focus', tone: 'good' });
      }
    }, 500);

    return () => clearInterval(interval);
  }, [stream, guideEnabled, error]);

  useEffect(() => {
    if (!isOpen) {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }
      return;
    }

    let isMounted = true;
    async function startCamera() {
      try {
        setError(null);
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (isMounted) {
          setStream(mediaStream);
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }
        }
      } catch (err: any) {
        console.error('Camera stream error:', err);
        setError('Camera access is restricted or unavailable in this browser preview. You can use standard file picker or photo capture.');
      }
    }

    startCamera();

    return () => {
      isMounted = false;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isOpen, facingMode]);

  if (!isOpen) return null;

  const handleTakePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      onCapture(dataUrl);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-4">
      {/* Top Header */}
      <div className="w-full max-w-md flex items-center justify-between text-white py-2">
        <div>
          <h3 className="font-bold text-sm text-amber-300">{title}</h3>
          <p className="text-xs text-stone-400">⚡ Flash OFF • Align center</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleGuide}
            title={guideEnabled ? 'Framing guide is on - tap to hide' : 'Framing guide is off - tap to show'}
            className={`px-3 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors ${
              guideEnabled ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-stone-800 text-stone-400 border border-stone-700'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Guide</span>
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-stone-800 text-stone-300 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Viewfinder Container */}
      <div className="relative w-full max-w-md aspect-square bg-stone-950 rounded-2xl overflow-hidden border-2 border-amber-500/40 flex items-center justify-center">
        {error ? (
          <div className="p-4 text-center text-xs text-stone-300 space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
            <p>{error}</p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-amber-500 text-stone-950 font-bold rounded-lg"
            >
              Use Phone File / Camera Button
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Viewfinder Framing Overlay - toggle-able */}
            {guideEnabled && (
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
                <div className="w-full h-full rounded-2xl border-2 border-dashed border-amber-400/80 max-w-[280px] max-h-[280px] flex flex-col items-center justify-between p-2">
                  <div className="text-[10px] bg-stone-900/80 text-amber-200 px-2 py-0.5 rounded font-mono">
                    FILL 70% OF FRAME
                  </div>
                  <div className="w-6 h-6 border-t-2 border-l-2 border-amber-400 self-start" />
                  {liveReadout ? (
                    <div
                      className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                        liveReadout.tone === 'good' ? 'bg-emerald-900/80 text-emerald-300' : 'bg-black/70 text-amber-200'
                      }`}
                    >
                      {liveReadout.label.toUpperCase()}
                    </div>
                  ) : (
                    <div className="text-[10px] text-amber-200/80 font-mono bg-black/60 px-2 rounded">
                      NO HARSH GLARE
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Shutter Controls */}
      <div className="w-full max-w-md flex items-center justify-around py-4">
        <button
          onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
          className="p-3 rounded-full bg-stone-800 text-stone-300 hover:text-white"
          title="Switch Camera"
        >
          <RefreshCw className="w-5 h-5" />
        </button>

        {/* Big Shutter Button */}
        <button
          onClick={handleTakePhoto}
          disabled={Boolean(error)}
          className="w-18 h-18 rounded-full bg-gradient-to-tr from-amber-400 to-amber-600 p-1 flex items-center justify-center shadow-lg active:scale-95 transition-transform disabled:opacity-50"
        >
          <div className="w-full h-full rounded-full border-4 border-stone-950 bg-stone-100 flex items-center justify-center">
            <Camera className="w-7 h-7 text-stone-950" />
          </div>
        </button>

        {/* Native phone camera input fallback */}
        <label className="p-3 rounded-full bg-stone-800 text-stone-300 hover:text-white text-xs font-semibold cursor-pointer flex items-center justify-center">
          <span>Upload</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (event) => {
                if (typeof event.target?.result === 'string') {
                  onCapture(event.target.result);
                  onClose();
                }
              };
              reader.readAsDataURL(file);
            }}
          />
        </label>
      </div>
    </div>
  );
};