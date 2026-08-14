import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, RefreshCw, ZapOff, Check, AlertCircle } from 'lucide-react';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
  title: string;
  isMacro?: boolean;
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onCapture,
  title,
  isMacro = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

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
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-stone-800 text-stone-300 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>
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

            {/* Viewfinder Framing Overlay */}
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
              <div
                className={`w-full h-full rounded-2xl border-2 border-dashed ${
                  isMacro ? 'border-amber-400 max-w-[200px] max-h-[200px]' : 'border-amber-400/80 max-w-[280px] max-h-[280px]'
                } flex flex-col items-center justify-between p-2`}
              >
                <div className="text-[10px] bg-stone-900/80 text-amber-200 px-2 py-0.5 rounded font-mono">
                  {isMacro ? 'MACRO: BIS 916 / 750 STAMP' : 'FILL 70% OF FRAME'}
                </div>
                <div className="w-6 h-6 border-t-2 border-l-2 border-amber-400 self-start" />
                <div className="text-[10px] text-amber-200/80 font-mono bg-black/60 px-2 rounded">
                  NO HARSH GLARE
                </div>
              </div>
            </div>
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
