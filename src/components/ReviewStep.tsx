import React, { useRef } from 'react';
import {
  Check,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Camera,
  ArrowRight,
  ChevronLeft,
  CheckCircle2,
  WifiOff,
} from 'lucide-react';
import { PhotoItem, GoldPurity, ProductGender, ReviewDecision } from '../types';
import { ProcessingStatusCard } from './ProcessingStatusCard';
import { Loader2 } from 'lucide-react';

interface ReviewStepProps {
  sku: string;
  cpc?: string;
  productName: string;
  itemType: string;
  purity: GoldPurity;
  gender: ProductGender;
  photo: PhotoItem;
  onUpdateReviewDecision: (decision: ReviewDecision) => void;
  onRegeneratePhoto: () => void;
  onRetakePhoto: (newDataUrl: string) => void;
  onBackToPhotos: () => void;
  onProceedToExport: () => void;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  sku,
  cpc,
  productName,
  itemType,
  purity,
  photo,
  onUpdateReviewDecision,
  onRegeneratePhoto,
  onRetakePhoto,
  onBackToPhotos,
  onProceedToExport,
}) => {
  const displayCpc = cpc || sku;
  const retakeInputRef = useRef<HTMLInputElement | null>(null);

  const handleRetakeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        onRetakePhoto(event.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const isProcessing = photo.status === 'processing';
  const isReshoot = photo.status === 'needs_reshoot';
  const isFailed = photo.status === 'failed';
  const isApproved = photo.status === 'approved';
  const decision = photo.reviewDecision;

  return (
    <div className="space-y-4">
      <input ref={retakeInputRef} type="file" accept="image/*" capture="environment" onChange={handleRetakeFile} className="hidden" />

      {/* Header Summary */}
      <div className="bg-white border border-stone-200 rounded-3xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToPhotos}
            className="p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors"
            title="Back to Capture"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-sm sm:text-base text-red-700 bg-red-50 px-2.5 py-0.5 rounded-lg border border-red-200">{displayCpc}</span>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-900 font-bold border border-amber-300 uppercase tracking-wider">
                {purity} {itemType}
              </span>
            </div>
            <p className="text-xs text-stone-500 font-medium mt-0.5">{productName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {isProcessing && (
            <span className="px-3 py-1 rounded-full bg-stone-100 border border-stone-200 text-stone-600 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Processing</span>
            </span>
          )}
          {isApproved && (
            <span className="px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Ready</span>
            </span>
          )}
          {isReshoot && (
            <span className="px-3 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Reshoot Needed</span>
            </span>
          )}
          {isFailed && (
            <span className="px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <WifiOff className="w-3.5 h-3.5" />
              <span>Enhancement Failed</span>
            </span>
          )}
        </div>
      </div>

      {isProcessing ? (
        <div className="space-y-4">
          <ProcessingStatusCard photo={photo} />
          <div className="max-w-md mx-auto aspect-square bg-stone-50 rounded-2xl overflow-hidden border border-stone-200 relative flex items-center justify-center">
            <img src={photo.originalImage} alt="Raw Counter Photo" className="w-full h-full object-contain" />
          </div>
        </div>
      ) : isReshoot ? (
        <div className="bg-white border-2 border-red-200 rounded-3xl p-5 sm:p-7 text-stone-900 space-y-4 shadow-xs">
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 p-4 rounded-2xl">
            <AlertTriangle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-serif italic font-bold text-base sm:text-lg text-red-900">
                Quality Check: Reshoot Required
              </h3>
              <p className="text-xs sm:text-sm text-stone-700 mt-1 leading-relaxed">
                <strong>Reason:</strong> {photo.reshootReason || 'Photo obstructed or out of focus.'}
              </p>
              <p className="text-[11px] text-stone-500 mt-1">
                This photo can't go to the catalogue as-is. Please retake it and try again.
              </p>
            </div>
          </div>

          <div className="max-w-md mx-auto aspect-square bg-stone-50 rounded-2xl overflow-hidden border border-stone-200 relative flex items-center justify-center">
            <img src={photo.originalImage} alt="Raw Counter Photo" className="w-full h-full object-contain" />
            <div className="absolute top-3 left-3 bg-red-600 text-white px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider shadow-xs">
              Flagged Capture
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => retakeInputRef.current?.click()}
              className="w-full sm:w-auto py-3.5 px-8 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-xs flex items-center justify-center gap-2 transition-all"
            >
              <Camera className="w-4 h-4 text-white" />
              <span>Retake Photo Now</span>
            </button>
          </div>
        </div>
      ) : isFailed ? (
        <div className="bg-white border-2 border-amber-200 rounded-3xl p-5 sm:p-7 text-stone-900 space-y-4 shadow-xs">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 p-4 rounded-2xl">
            <WifiOff className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-serif italic font-bold text-base sm:text-lg text-amber-900">
                Enhancement Failed
              </h3>
              <p className="text-xs sm:text-sm text-stone-700 mt-1 leading-relaxed">
                <strong>Reason:</strong> {photo.failureReason || 'The service did not respond.'}
              </p>
              <p className="text-[11px] text-stone-500 mt-1">
                This is a service hiccup, not a problem with your photo - no need to retake, just try again.
              </p>
              {photo.debugDetail && (
                <p className="text-[10px] text-stone-400 mt-2 font-mono bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 break-words">
                  Technical detail (for reporting this issue): {photo.debugDetail}
                </p>
              )}
            </div>
          </div>

          <div className="max-w-md mx-auto aspect-square bg-stone-50 rounded-2xl overflow-hidden border border-stone-200 relative flex items-center justify-center">
            <img src={photo.originalImage} alt="Raw Counter Photo" className="w-full h-full object-contain" />
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={onRegeneratePhoto}
              className="w-full sm:w-auto py-3.5 px-8 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-xs flex items-center justify-center gap-2 transition-all"
            >
              <RefreshCw className="w-4 h-4 text-white" />
              <span>Retry Enhancement</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-7 space-y-5 shadow-xs text-stone-900">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="font-serif italic font-bold text-lg text-stone-900">{photo.title}</span>
              {photo.isSample ? (
                <span className="text-[10px] bg-amber-50 text-amber-800 px-2.5 py-0.5 rounded-full border border-amber-200 font-bold uppercase tracking-wider">
                  Demo Sample - Not Enhanced
                </span>
              ) : (
                <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full border border-emerald-200 font-bold uppercase tracking-wider">
                  Studio E-Commerce Grade
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-stone-800 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Studio Enhanced</span>
                </span>
              </div>
              <div className="aspect-square bg-stone-50 border border-stone-200 rounded-2xl overflow-hidden flex items-center justify-center p-3 relative shadow-xs">
                <img src={photo.processedImage || photo.originalImage} alt="Processed" className="w-full h-full object-contain" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-stone-600">Raw Counter Photo</span>
              </div>
              <div className="aspect-square bg-stone-50 border border-stone-200 rounded-2xl overflow-hidden flex items-center justify-center p-3 shadow-xs">
                <img src={photo.originalImage} alt="Original Raw" className="w-full h-full object-contain" />
              </div>
            </div>
          </div>

          <p className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
            Please double-check the enhanced photo genuinely matches your piece - same design, same proportions, nothing added or missing - before approving.
          </p>

          <div className="pt-3 border-t border-stone-100 space-y-3">
            <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={() => onUpdateReviewDecision('approved')}
                className={`py-3.5 px-3 rounded-xl font-bold text-xs sm:text-sm uppercase tracking-wider flex flex-col sm:flex-row items-center justify-center gap-2 transition-all ${
                  decision === 'approved'
                    ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-400'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                }`}
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>Approve</span>
              </button>

              <button
                type="button"
                onClick={onRegeneratePhoto}
                className="py-3.5 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 font-bold text-xs sm:text-sm uppercase tracking-wider flex flex-col sm:flex-row items-center justify-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 text-stone-500" />
                <span>Regenerate</span>
              </button>

              <button
                type="button"
                onClick={() => retakeInputRef.current?.click()}
                className="py-3.5 px-3 rounded-xl bg-stone-100 hover:bg-red-50 hover:text-red-700 hover:border-red-200 text-stone-700 border border-stone-200 font-bold text-xs sm:text-sm uppercase tracking-wider flex flex-col sm:flex-row items-center justify-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>Discard / Retake</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Navigation Bar */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-end gap-3 shadow-xs">
        <button
          type="button"
          onClick={onProceedToExport}
          disabled={decision !== 'approved'}
          className="w-full sm:w-auto py-3.5 sm:py-4 px-8 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-md shadow-red-900/15 flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
        >
          <span>Finalize & Export</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};