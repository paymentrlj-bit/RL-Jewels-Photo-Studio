// Barcode / QR scanner for the CPC on a physical tag.
//
// Replaces v1's 937-line BarcodeScannerModal, which also drove a two-sided
// OCR flow with its own state machine. This does one job: read a code off a
// tag and hand it back. The CPC lookup that follows happens in the form,
// where the staff member can see and correct what it filled in.

import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { X, ScanLine, AlertCircle } from 'lucide-react';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({ isOpen, onClose, onScan }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let stopped = false;
    // The zxing controls handle is only available after start resolves, so it
    // is captured here and used by the cleanup below.
    let controls: { stop: () => void } | null = null;

    const reader = new BrowserMultiFormatReader();
    setError(null);
    setLastCode(null);

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (stopped || !result) return;
        const text = result.getText().trim();
        if (!text) return;
        setLastCode(text);
        // Stop before handing the code up, so the camera light goes out the
        // moment the scan lands rather than when React gets round to it.
        controls?.stop();
        stopped = true;
        onScan(text);
      })
      .then((c) => {
        controls = c;
        if (stopped) c.stop();
      })
      .catch((err: Error) => {
        setError(
          err.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow camera permission for this site, then try again.'
            : err.message || 'Could not start the camera.'
        );
      });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [isOpen, onScan]);

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

        <div className="relative bg-black aspect-[4/3]">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          {!error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-3/4 h-1/3 border-2 border-amber-400/80 rounded-lg" />
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

        <div className="px-5 py-4 text-sm text-stone-600">
          {lastCode ? (
            <span className="text-emerald-700 font-medium">Scanned {lastCode}</span>
          ) : (
            'Hold the tag steady inside the frame. Barcodes and QR codes both work.'
          )}
        </div>
      </div>
    </div>
  );
};
