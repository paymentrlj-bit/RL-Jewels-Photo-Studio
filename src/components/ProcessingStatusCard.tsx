import React from 'react';
import { Loader2, CheckCircle2, WifiOff, AlertTriangle, RefreshCw } from 'lucide-react';
import { PhotoItem, ProcessingStage } from '../types';

interface ProcessingStatusCardProps {
  photo: PhotoItem;
  onRetry?: () => void;
}

const STAGE_LABEL: Record<ProcessingStage, string> = {
  segmenting: 'Analyzing the piece…',
  enhancing: 'Retouching & correcting color…',
  auditing: 'Running quality check…',
  escalating: 'Applying a higher-quality correction pass…',
};

const STAGE_PERCENT: Record<ProcessingStage, number> = {
  segmenting: 15,
  enhancing: 50,
  auditing: 78,
  escalating: 88,
};

// Compact, non-blocking status widget - shown while a photo is enhancing in
// the background (staff can keep filling in product details alongside it),
// and reused as-is on the Review step as a safety net if someone lands there
// before processing has finished.
export const ProcessingStatusCard: React.FC<ProcessingStatusCardProps> = ({ photo, onRetry }) => {
  if (photo.status === 'processing') {
    const stage = photo.processingStage;
    const percent = stage ? STAGE_PERCENT[stage] : 8;
    return (
      <div className="bg-white border border-amber-200 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
            <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-stone-900 text-sm">
              {stage ? STAGE_LABEL[stage] : 'Starting…'}
            </div>
            <div className="text-[11px] text-stone-500 mt-0.5">
              Studio is working on your photo in the background — keep filling in the details below.
            </div>
          </div>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-stone-100 overflow-hidden">
          <div
            className="h-full rounded-full animate-shimmer-bar transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (photo.status === 'approved') {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 sm:p-5 shadow-xs flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white border border-emerald-200 overflow-hidden shrink-0">
          {photo.processedImage && (
            <img src={photo.processedImage} alt="" className="w-full h-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-emerald-900 text-sm flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Photo Ready</span>
          </div>
          <div className="text-[11px] text-emerald-800/80 mt-0.5">
            Finish the details below, then head to Review to approve and export.
          </div>
        </div>
      </div>
    );
  }

  if (photo.status === 'failed') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white border border-amber-200 flex items-center justify-center shrink-0">
            <WifiOff className="w-5 h-5 text-amber-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-amber-900 text-sm">Enhancement Failed</div>
            <div className="text-[11px] text-amber-800/80 mt-0.5">
              {photo.failureReason || 'The service did not respond.'} This is a service hiccup, not a problem with your photo.
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="min-h-[36px] shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (photo.status === 'needs_reshoot') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 sm:p-5 shadow-xs flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-white border border-red-200 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-red-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-red-900 text-sm">Reshoot Needed</div>
          <div className="text-[11px] text-red-800/80 mt-0.5">
            {photo.reshootReason || 'Photo obstructed or out of focus.'} Go back to Capture Photo to retake it.
          </div>
        </div>
      </div>
    );
  }

  return null;
};
