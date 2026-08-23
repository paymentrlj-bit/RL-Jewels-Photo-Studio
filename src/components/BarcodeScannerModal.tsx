import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  X,
  Camera,
  Scan,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  ArrowRight,
  Loader2,
  FileText,
  Barcode,
  RotateCcw,
  Layers,
  Zap,
} from 'lucide-react';
import jsQR from 'jsqr';
import { GoldPurity, ProductGender } from '../types';
import { parseJewelryTagText, mergeScannedTagData } from '../utils/tagParser';
import { logClientEvent } from '../utils/analytics';

export interface ScannedProductData {
  cpc: string;
  name: string;
  itemType: string;
  purity: GoldPurity;
  gender: ProductGender;
  grossWeight: string;
  otherWeight: string;
  netWeight: string;
  size?: string;
  label?: string;
  // How the weights were actually derived - 'labeled' (explicit GW/OW/NW tag
  // match) is far more trustworthy than 'fallback' (guessed from an
  // unlabeled decimal array). Logged with every scan for accuracy tracking.
  weightParseMethod?: 'labeled' | 'table' | 'fallback' | 'none';
}

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (data: ScannedProductData) => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<any>(null);

  // Two-Sided Tag Tracking
  const [currentSide, setCurrentSide] = useState<'side1' | 'side2'>('side1');
  const [side1Data, setSide1Data] = useState<ScannedProductData | null>(null);
  const [side2Data, setSide2Data] = useState<ScannedProductData | null>(null);
  const [combinedData, setCombinedData] = useState<ScannedProductData | null>(null);
  const [side1Snapshot, setSide1Snapshot] = useState<string | null>(null);
  const [side2Snapshot, setSide2Snapshot] = useState<string | null>(null);

  // Camera & Scan Control
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [autoScanActive, setAutoScanActive] = useState(true);
  const [autoScanAttempts, setAutoScanAttempts] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [rawExtractedText, setRawExtractedText] = useState<string>('');

  // Stop camera stream cleanly
  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  // Helper to grab current video frame as base64 JPEG
  const captureCurrentFrame = useCallback((): string | null => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, []);

  // Fast Barcode / QR extraction on a frame
  const extractBarcodeFromFrame = (videoOrCanvas: HTMLVideoElement | HTMLCanvasElement): string | null => {
    try {
      let canvas: HTMLCanvasElement;
      if (videoOrCanvas instanceof HTMLVideoElement) {
        canvas = document.createElement('canvas');
        canvas.width = videoOrCanvas.videoWidth;
        canvas.height = videoOrCanvas.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(videoOrCanvas, 0, 0, canvas.width, canvas.height);
      } else {
        canvas = videoOrCanvas;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data && code.data.trim().length > 0) {
        return code.data.trim();
      }
    } catch {
      // ignore
    }
    return null;
  };

  // Runs the same on-device barcode/QR detection used by the live auto-scan
  // loop (checkBarcodeOnFrame below) against a still image instead of the
  // live video element - needed here because Side 1's manual-capture and
  // file-upload paths hand processImageContent a base64 image, not a
  // video frame to read live.
  const detectBarcodeFromImageBase64 = async (imageBase64: string): Promise<string | null> => {
    const img = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Could not load captured image.'));
        img.src = imageBase64;
      });
    } catch {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);

    if ('BarcodeDetector' in window) {
      try {
        const barcodeDetector = new (window as any).BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'],
        });
        const barcodes = await barcodeDetector.detect(canvas);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          const rawCode = barcodes[0].rawValue.trim();
          if (rawCode.length >= 3) return rawCode;
        }
      } catch {
        // fall through to jsQR below
      }
    }
    return extractBarcodeFromFrame(canvas);
  };

  /**
   * Side 1's ONLY job is reading the QR/barcode to get the CPC number - the
   * CPC master lookup (see ProductForm.tsx's performCpcLookup, triggered
   * from onScanSuccess) supplies name/item type/purity/size once the app
   * has that CPC, far more reliably than OCR ever could. So Side 1 never
   * calls OCR at all: no server round trip, no OCR.space quota spent, on
   * fields nothing uses anymore. Side 2 (the back label) still needs real
   * OCR - weight can only come from actually reading the printed numbers.
   */
  const processImageContent = async (imageBase64: string, targetSide: 'side1' | 'side2') => {
    setIsProcessing(true);
    setAutoScanActive(false); // Stop live loop upon capture
    setCameraError(null);

    if (targetSide === 'side1') {
      setStatusMessage('⚡ Scanning for QR/Barcode on Side 1...');
      const detectedBarcode = await detectBarcodeFromImageBase64(imageBase64);
      if (detectedBarcode) {
        const parsed = parseJewelryTagText(''); // no OCR text - defaults only, cpc set below
        parsed.cpc = detectedBarcode;
        handleParsedSuccess(parsed, imageBase64, 'side1', `Barcode: ${detectedBarcode}`);
      } else {
        setStatusMessage('No QR/barcode found - align the code in the reticle and try again, or close this and type the CPC in manually.');
        setIsProcessing(false);
        setAutoScanActive(true);
      }
      return;
    }

    // Side 2 (weights) - still needs real OCR of the printed label.
    setStatusMessage('⚡ Free OCR Scanning on Side 2 (Weights)...');
    let detectedBarcode: string | null = null;
    if (videoRef.current) {
      detectedBarcode = extractBarcodeFromFrame(videoRef.current);
    }

    try {
      const ocrRes = await fetch('/api/ocr-space', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64 }),
      });
      const ocrData = await ocrRes.json();
      const txt = ocrData?.rawText || '';

      const parsed = parseJewelryTagText(txt, side1Data || undefined);
      if (detectedBarcode && (!parsed.cpc || parsed.cpc === 'RLJ-TAG')) {
        parsed.cpc = detectedBarcode;
      }
      handleParsedSuccess(parsed, imageBase64, targetSide, txt || (detectedBarcode ? `Barcode: ${detectedBarcode}` : 'Tag Captured'));
    } catch (fallbackErr: any) {
      console.warn('OCR notice:', fallbackErr);
      const parsed = parseJewelryTagText(detectedBarcode || '', side1Data || undefined);
      if (detectedBarcode) {
        parsed.cpc = detectedBarcode;
      }
      handleParsedSuccess(parsed, imageBase64, targetSide, detectedBarcode || 'Scanned');
    } finally {
      setIsProcessing(false);
    }
  };

  // Helper when data is extracted successfully from a side
  const handleParsedSuccess = (
    parsed: ScannedProductData,
    snapshot: string,
    side: 'side1' | 'side2',
    rawText: string
  ) => {
    setRawExtractedText(rawText);

    if (side === 'side1') {
      setSide1Data(parsed);
      setSide1Snapshot(snapshot);
      const merged = mergeScannedTagData(parsed, side2Data);
      setCombinedData(merged);
      setStatusMessage('✨ Side 1 Captured! Flip tag to Side 2 (Weights) or Apply to form.');
    } else {
      setSide2Data(parsed);
      setSide2Snapshot(snapshot);
      const merged = mergeScannedTagData(side1Data, parsed);
      setCombinedData(merged);
      setStatusMessage('✅ Both sides captured! All product specs ready to apply.');
    }
    setIsProcessing(false);
  };

  // Scan frame for 1D/2D Barcode (QR, Code128, EAN13)
  const checkBarcodeOnFrame = useCallback(async () => {
    if (!videoRef.current || videoRef.current.readyState < 2 || isProcessing || !autoScanActive) {
      return;
    }

    const video = videoRef.current;
    if (video.videoWidth <= 0 || video.videoHeight <= 0) return;

    // Increment attempt counter - auto pause after 4 attempts to prevent battery drain
    setAutoScanAttempts((prev) => {
      const next = prev + 1;
      if (next >= 4) {
        setAutoScanActive(false);
        setStatusMessage('Auto-scan paused. Align tag in reticle and tap "Capture & OCR".');
      }
      return next;
    });

    const frameBase64 = captureCurrentFrame();
    if (!frameBase64) return;

    // 1. Try Native BarcodeDetector (Chrome Android on Realme NARZO)
    if ('BarcodeDetector' in window) {
      try {
        const barcodeDetector = new (window as any).BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'],
        });
        const barcodes = await barcodeDetector.detect(video);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          const rawCode = barcodes[0].rawValue.trim();
          if (rawCode.length >= 3) {
            // Trigger fast server scan with known CPC code
            processImageContent(frameBase64, currentSide);
            return;
          }
        }
      } catch {
        // fallback to jsQR
      }
    }

    // 2. Try jsQR for QR Code
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data && code.data.trim().length >= 3) {
          processImageContent(frameBase64, currentSide);
          return;
        }
      }
    } catch {
      // ignore
    }
  }, [isProcessing, autoScanActive, captureCurrentFrame, currentSide]);

  // Set up periodic barcode/QR checker (debounced every 400ms)
  useEffect(() => {
    if (cameraActive && autoScanActive && !isProcessing) {
      scanIntervalRef.current = setInterval(() => {
        checkBarcodeOnFrame();
      }, 400);
    } else {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    }

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    };
  }, [cameraActive, autoScanActive, isProcessing, checkBarcodeOnFrame]);

  // Helper to ensure camera stream is actively playing
  const ensureCameraPlaying = useCallback(async () => {
    if (videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      try {
        await videoRef.current.play();
        setCameraActive(true);
      } catch (err) {
        console.warn('Video resume notice:', err);
      }
    }
  }, []);

  // Start Camera Stream when modal opens
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setSide1Data(null);
      setSide2Data(null);
      setCombinedData(null);
      setSide1Snapshot(null);
      setSide2Snapshot(null);
      setCurrentSide('side1');
      setCameraError(null);
      setStatusMessage('');
      setRawExtractedText('');
      setAutoScanAttempts(0);
      setAutoScanActive(true);
      return;
    }

    let isMounted = true;

    async function startCamera() {
      setCameraError(null);
      setAutoScanAttempts(0);
      setAutoScanActive(true);

      const constraintOptions: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        },
        {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        {
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        },
        {
          video: true,
          audio: false,
        },
      ];

      let stream: MediaStream | null = null;
      let lastErr: any = null;

      for (const constraints of constraintOptions) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!isMounted) {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        return;
      }

      if (stream) {
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute('playsinline', 'true');
          video.setAttribute('webkit-playsinline', 'true');
          video.muted = true;
          video.autoplay = true;

          try {
            await video.play();
            setCameraActive(true);
          } catch (playErr) {
            console.warn('Video play notice:', playErr);
            setCameraActive(true);
          }
        }
      } else {
        console.warn('Camera stream notice:', lastErr);
        setCameraError('Live camera access is restricted. Tap "Take Tag Photo" or upload tag image.');
        setCameraActive(false);
      }
    }

    const timeout = setTimeout(() => {
      startCamera();
    }, 50);

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      stopCamera();
    };
  }, [isOpen, facingMode, stopCamera]);

  // Trigger manual capture and fast AI OCR on current frame
  const handleManualCapture = () => {
    const frame = captureCurrentFrame();
    if (frame) {
      processImageContent(frame, currentSide);
    }
  };

  // Handle uploaded tag photo
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        processImageContent(event.target.result, currentSide);
      }
    };
    reader.readAsDataURL(file);
  };

  // Switch to Side 2 (Weights & Back) - ensures live camera view is immediately active
  const handleSwitchToSide2 = () => {
    setCurrentSide('side2');
    setAutoScanAttempts(0);
    setAutoScanActive(true);
    setStatusMessage('Align Side 2 of tag (GW, OW, NW) in frame.');
    ensureCameraPlaying();
  };

  // Retake current side - instantly re-enables live video
  const handleRetakeSide = (side: 'side1' | 'side2') => {
    if (side === 'side1') {
      setSide1Data(null);
      setSide1Snapshot(null);
      setCurrentSide('side1');
    } else {
      setSide2Data(null);
      setSide2Snapshot(null);
      setCurrentSide('side2');
    }
    setAutoScanAttempts(0);
    setAutoScanActive(true);
    setStatusMessage(`Position ${side === 'side1' ? 'Side 1 (QR/Specs)' : 'Side 2 (Weights)'} in reticle.`);
    ensureCameraPlaying();
  };

  // Apply complete results directly into Product Form
  const handleApplyResult = () => {
    const finalData = combinedData || side1Data || side2Data;
    if (finalData) {
      logClientEvent('ocr_scan_applied', {
        hasCpc: Boolean(finalData.cpc && finalData.cpc !== 'RLJ-TAG'),
        hasGrossWeight: parseFloat(finalData.grossWeight) > 0,
        hasOtherWeight: parseFloat(finalData.otherWeight) > 0,
        itemType: finalData.itemType,
        purity: finalData.purity,
        capturedBothSides: Boolean(side1Data && side2Data),
        weightParseMethod: finalData.weightParseMethod || 'none',
      });
      onScanSuccess(finalData);
      onClose();
    }
  };

  if (!isOpen) return null;

  const currentSnapshot = currentSide === 'side1' ? side1Snapshot : side2Snapshot;
  const isCurrentSideCaptured = currentSide === 'side1' ? Boolean(side1Data) : Boolean(side2Data);

  return (
    <div id="barcode-scanner-modal-backdrop" className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div id="barcode-scanner-modal-card" className="bg-white border border-stone-200 rounded-3xl max-w-md w-full overflow-hidden shadow-2xl flex flex-col max-h-[94vh]">
        
        {/* Hidden Camera/File Input for mobile photo capture */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
              <Scan className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-base">Jewelry Tag Scanner</h3>
              <p className="text-xs text-stone-500 font-medium flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-600 inline" /> Sub-Second Extraction
              </p>
            </div>
          </div>
          <button
            id="close-scanner-modal-btn"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 flex-1">
          
          {/* Two-Sided Step Tabs Indicator */}
          <div className="grid grid-cols-2 gap-2 bg-stone-100 p-1.5 rounded-2xl border border-stone-200">
            <button
              id="switch-tab-side1"
              type="button"
              onClick={() => {
                setCurrentSide('side1');
                ensureCameraPlaying();
              }}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                currentSide === 'side1'
                  ? 'bg-white text-stone-900 shadow-xs border border-stone-200'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              {side1Data ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-stone-200 text-stone-700 text-[10px] flex items-center justify-center font-bold">1</span>
              )}
              <span className="truncate">Side 1 (QR/Specs)</span>
            </button>

            <button
              id="switch-tab-side2"
              type="button"
              onClick={() => {
                setCurrentSide('side2');
                ensureCameraPlaying();
              }}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                currentSide === 'side2'
                  ? 'bg-white text-stone-900 shadow-xs border border-stone-200'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              {side2Data ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-stone-200 text-stone-700 text-[10px] flex items-center justify-center font-bold">2</span>
              )}
              <span className="truncate">Side 2 (Weights/GW)</span>
            </button>
          </div>

          {/* Camera / Snapshot Box - Video element is ALWAYS mounted to prevent stream loss */}
          <div className="relative aspect-video w-full rounded-2xl bg-stone-950 overflow-hidden border border-stone-300 flex items-center justify-center shadow-inner">
            
            {/* Always-Mounted Live Video Stream */}
            <video
              ref={videoRef}
              playsInline
              webkit-playsinline="true"
              muted
              autoPlay
              className="w-full h-full object-cover"
            />

            {/* Fallback View when camera stream is denied */}
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-stone-400 space-y-2 z-10 bg-stone-950">
                <Camera className="w-9 h-9 text-stone-500 animate-pulse" />
                <p className="text-xs max-w-xs text-stone-300">
                  {cameraError || 'Connecting to counter camera...'}
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[44px] px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 border border-stone-700"
                >
                  <Camera className="w-4 h-4 text-amber-400" />
                  <span>Take Tag Photo</span>
                </button>
              </div>
            )}

            {/* If current side was successfully captured, display the freeze-frame snapshot on top */}
            {isCurrentSideCaptured && currentSnapshot && (
              <div className="absolute inset-0 z-20 bg-black">
                <img
                  src={currentSnapshot}
                  alt={`${currentSide} snapshot`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-emerald-950/25 border-4 border-emerald-500 pointer-events-none flex items-center justify-center">
                  <div className="bg-black/80 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 border border-emerald-400 shadow-lg">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>{currentSide === 'side1' ? 'Side 1 Captured' : 'Side 2 Captured'}</span>
                  </div>
                </div>
                <button
                  id={`rescan-${currentSide}-btn`}
                  type="button"
                  onClick={() => handleRetakeSide(currentSide)}
                  className="min-w-[44px] min-h-[44px] absolute bottom-2 right-2 px-3 py-1.5 bg-stone-900/90 hover:bg-stone-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg border border-stone-600 active:scale-95 transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span>Rescan</span>
                </button>
              </div>
            )}

            {/* Target Reticle Overlay (visible when scanning) */}
            {!isCurrentSideCaptured && (
              <div className="absolute inset-4 sm:inset-6 border-2 border-dashed border-amber-500/80 rounded-2xl pointer-events-none flex flex-col justify-between p-2 z-10">
                <div className="flex justify-between items-center">
                  <div className="w-4 h-4 border-t-2 border-l-2 border-amber-500" />
                  <span className="text-[10px] uppercase font-mono font-bold tracking-wider bg-black/75 text-amber-300 px-2 py-0.5 rounded backdrop-blur-xs flex items-center gap-1">
                    <Barcode className="w-3 h-3" />
                    <span>{currentSide === 'side1' ? 'ALIGN SIDE 1 (QR / SPECS)' : 'ALIGN SIDE 2 (WEIGHTS)'}</span>
                  </span>
                  <div className="w-4 h-4 border-t-2 border-r-2 border-amber-500" />
                </div>
                
                {/* Processing Status Banner or Laser Line */}
                {isProcessing ? (
                  <div className="w-full text-center py-2 bg-stone-950/90 rounded-lg text-white text-xs font-mono font-bold flex items-center justify-center gap-2 shadow-md border border-amber-500/40">
                    <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                    <span>⚡ Extracting Tag Specs...</span>
                  </div>
                ) : autoScanActive ? (
                  <div className="w-full h-0.5 bg-amber-400 shadow-[0_0_8px_#f59e0b] animate-laser" />
                ) : (
                  <div className="w-full text-center py-1.5 bg-black/60 rounded-md text-stone-200 text-[11px] font-mono">
                    Tap "Capture & OCR" to scan
                  </div>
                )}

                <div className="flex justify-between">
                  <div className="w-4 h-4 border-b-2 border-l-2 border-amber-500" />
                  <div className="w-4 h-4 border-b-2 border-r-2 border-amber-500" />
                </div>
              </div>
            )}

            {/* Top Switch Camera Button */}
            {cameraActive && !isCurrentSideCaptured && (
              <button
                type="button"
                onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                className="min-w-[44px] min-h-[44px] absolute top-2 right-2 p-2.5 rounded-xl bg-stone-900/80 text-white hover:bg-stone-800 transition-colors shadow-md flex items-center justify-center z-20"
                title="Switch Camera"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Action Buttons: Capture & Side Progression */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                id="manual-capture-ocr-btn"
                type="button"
                onClick={handleManualCapture}
                disabled={isProcessing || !cameraActive}
                className="min-h-[48px] py-3 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-95"
              >
                <Scan className="w-4 h-4" />
                <span>Capture & OCR</span>
              </button>

              <button
                id="take-photo-upload-btn"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="min-h-[48px] py-3 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs uppercase tracking-wider border border-stone-200 flex items-center justify-center gap-1.5 transition-all active:scale-95"
              >
                <Camera className="w-4 h-4 text-amber-700" />
                <span>Take Photo</span>
              </button>
            </div>

            {/* If Side 1 is captured, prompt user to Flip & Scan Side 2 */}
            {side1Data && !side2Data && (
              <button
                id="flip-tag-to-side2-btn"
                type="button"
                onClick={handleSwitchToSide2}
                className="min-h-[48px] w-full py-3 px-4 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
              >
                <RotateCcw className="w-4 h-4 text-amber-400" />
                <span>Flip Tag to Scan Side 2 (Weights)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Status Message Banner */}
          {statusMessage && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2 rounded-xl flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="font-medium">{statusMessage}</span>
            </div>
          )}

          {/* Extracted Product Summary Card */}
          {(combinedData || side1Data || side2Data) && (
            <div id="extracted-specs-summary-card" className="bg-stone-50 border-2 border-emerald-500/80 rounded-2xl p-3.5 space-y-2.5 shadow-md animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Parsed Tag Specifications</span>
                </span>
                <span className="font-mono text-xs font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-300">
                  {combinedData?.cpc || side1Data?.cpc || side2Data?.cpc || 'RLJ-TAG'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white p-2.5 rounded-xl border border-stone-200">
                  <span className="text-[10px] text-stone-400 uppercase font-bold block">Item & Size</span>
                  <span className="font-bold text-stone-900 block truncate">
                    {combinedData?.name || side1Data?.name || 'Jewelry Piece'}
                  </span>
                  <span className="text-[10px] text-stone-500 capitalize">
                    {combinedData?.itemType || side1Data?.itemType} • Sz: {combinedData?.size || side1Data?.size || 'DEFAULT'}
                  </span>
                </div>

                <div className="bg-white p-2.5 rounded-xl border border-stone-200">
                  <span className="text-[10px] text-stone-400 uppercase font-bold block">Purity & Category</span>
                  <span className="font-bold text-amber-900 block">
                    {(combinedData?.purity || side1Data?.purity || '22kt').toUpperCase()} Gold
                  </span>
                  <span className="text-[10px] text-stone-500 capitalize">
                    {combinedData?.gender || side1Data?.gender || "women's"}
                  </span>
                </div>
              </div>

              {/* Weights breakdown */}
              <div className="bg-emerald-50/70 border border-emerald-200 p-2 rounded-xl grid grid-cols-3 gap-1 text-center font-mono">
                <div>
                  <span className="text-[9px] text-stone-500 uppercase block">Gross (GW)</span>
                  <span className="text-xs font-bold text-stone-800">
                    {combinedData?.grossWeight || side2Data?.grossWeight || side1Data?.grossWeight || '0.000'}g
                  </span>
                </div>
                <div>
                  <span className="text-[9px] text-stone-500 uppercase block">Other (OW)</span>
                  <span className="text-xs font-bold text-stone-800">
                    {combinedData?.otherWeight || side2Data?.otherWeight || side1Data?.otherWeight || '0.000'}g
                  </span>
                </div>
                <div>
                  <span className="text-[9px] text-emerald-700 font-bold uppercase block">Net (NW)</span>
                  <span className="text-xs font-bold text-emerald-900">
                    {combinedData?.netWeight || side2Data?.netWeight || side1Data?.netWeight || '0.000'}g
                  </span>
                </div>
              </div>

              {/* Apply All Specs Button */}
              <button
                id="apply-all-specs-to-form-btn"
                type="button"
                onClick={handleApplyResult}
                className="min-h-[48px] w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
              >
                <span>Apply All Specs to Form (Done)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Raw Extracted Text Viewer from AI Engine */}
          {rawExtractedText && (
            <div className="bg-stone-100 border border-stone-200 rounded-xl p-2.5 space-y-1">
              <span className="text-[10px] uppercase font-bold text-stone-500 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                <span>Extracted Text:</span>
              </span>
              <p className="text-xs font-mono text-stone-700 bg-white p-2 rounded border border-stone-200 whitespace-pre-line break-words max-h-20 overflow-y-auto">
                {rawExtractedText}
              </p>
            </div>
          )}

          {cameraError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2.5 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span className="font-medium">{cameraError}</span>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-3.5 sm:p-4 bg-stone-50 border-t border-stone-100 flex items-center justify-between text-xs">
          <span className="text-[11px] text-stone-400 font-medium">
            RL Jewels Two-Sided Tag Scanner
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};