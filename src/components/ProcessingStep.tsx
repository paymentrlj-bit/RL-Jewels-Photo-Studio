import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, AlertTriangle, ShieldCheck, Gem, Eye } from 'lucide-react';
import { PhotoItem, GoldPurity } from '../types';
import { BrandLogo } from './BrandLogo';

interface ProcessingStepProps {
  cpc: string;
  purity: GoldPurity;
  itemType: string;
  photos: PhotoItem[];
  currentIndex: number;
  totalToProcess: number;
}

export const ProcessingStep: React.FC<ProcessingStepProps> = ({
  cpc,
  purity,
  itemType,
  photos,
  currentIndex,
  totalToProcess,
}) => {
  const activePhotos = photos.filter((p) => Boolean(p.originalImage));
  const safeTotal = Math.max(1, totalToProcess);

  // Target percent based on step
  const targetPercent = Math.min(
    100,
    Math.round(((currentIndex + 0.5) / safeTotal) * 100)
  );

  // Smooth local percentage state that interpolates fluidly
  const [smoothPercent, setSmoothPercent] = useState(10);

  useEffect(() => {
    const calc = Math.min(100, Math.round(((currentIndex + 0.6) / safeTotal) * 100));
    setSmoothPercent(Math.max(15, calc));
  }, [currentIndex, safeTotal]);

  const currentPhoto = activePhotos[currentIndex] || activePhotos[0];

  return (
    <div className="max-w-2xl mx-auto bg-white border border-stone-200 rounded-3xl p-5 sm:p-8 text-stone-900 shadow-xs text-center space-y-6 my-4 sm:my-6 animate-in fade-in zoom-in duration-300">
      
      {/* Animated RL Jewels Brand Scanner Badge */}
      <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-red-100 animate-ping opacity-50" />
        <div className="absolute -inset-1 rounded-full border-2 border-dashed border-red-400 animate-spin [animation-duration:8s]" />
        <BrandLogo variant="3d-badge" size="md" className="relative z-10 animate-pulse-glow" />
      </div>

      {/* Main Title & Subtitle */}
      <div className="space-y-1.5">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-bold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-spin [animation-duration:4s]" />
          <span>RL Jewels Studio Inspection</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-serif italic font-bold text-stone-900">
          Auditing & Enhancing {cpc}
        </h2>
        <p className="text-xs sm:text-sm text-stone-500 max-w-md mx-auto">
          Inspecting {purity} {itemType} for hallmarking clarity, studio lighting, and tag clearance...
        </p>
      </div>

      {/* Smooth CSS-Based Animated Progress Bar Container */}
      <div className="bg-stone-50/80 border border-stone-200 rounded-2xl p-4 sm:p-5 space-y-2.5 shadow-xs">
        <div className="flex items-center justify-between text-xs font-bold">
          <span className="text-stone-700 flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 text-red-600 animate-spin" />
            <span>
              Inspecting Photo {Math.min(currentIndex + 1, safeTotal)} of {safeTotal}
            </span>
          </span>
          <span className="font-mono text-red-600 font-extrabold text-sm">
            {smoothPercent}%
          </span>
        </div>

        {/* Outer Bar */}
        <div className="w-full h-3.5 bg-stone-200/70 rounded-full p-0.5 overflow-hidden border border-stone-300 relative shadow-inner">
          {/* Animated Gradient Fill Bar with CSS Shimmer */}
          <div
            className="h-full rounded-full transition-all duration-700 ease-out animate-shimmer-bar relative overflow-hidden shadow-xs"
            style={{ width: `${smoothPercent}%` }}
          >
            {/* Specular Top Shine */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-white/40 rounded-full pointer-events-none" />
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-stone-400 font-medium pt-0.5">
          <span className="truncate max-w-[200px] text-left">
            Active: <strong className="text-stone-700">{currentPhoto?.title || 'Jewelry Slot'}</strong>
          </span>
          <span className="text-amber-800 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
            Multi-Angle AI Check
          </span>
        </div>
      </div>

      {/* Real-time Photos Processing Cards */}
      <div className="space-y-2 text-left text-xs">
        {activePhotos.map((photo, idx) => {
          const isCurrent = idx === currentIndex;
          const isPast = idx < currentIndex;
          const isFuture = idx > currentIndex;

          const isApproved = photo.status === 'approved' || isPast;
          const isReshoot = photo.status === 'needs_reshoot';
          const isProcessing = isCurrent || photo.status === 'processing';

          return (
            <div
              key={photo.id}
              className={`p-3 rounded-2xl border flex items-center justify-between transition-all duration-300 ${
                isProcessing
                  ? 'bg-amber-50 border-amber-300 text-stone-900 shadow-sm ring-1 ring-amber-400/40'
                  : isApproved
                  ? 'bg-white border-emerald-200 text-stone-900 shadow-xs'
                  : isReshoot
                  ? 'bg-red-50 border-red-200 text-stone-900'
                  : 'bg-stone-50 border-stone-200 text-stone-400 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-stone-900 shrink-0 border border-stone-200 relative">
                  <img src={photo.originalImage} alt="" className="w-full h-full object-cover" />
                  {isProcessing && (
                    <div className="absolute inset-0 bg-red-600/20 flex items-center justify-center">
                      <div className="w-full h-0.5 bg-amber-300 animate-laser" />
                    </div>
                  )}
                </div>
                <div>
                  <div className="font-bold text-stone-900 text-xs sm:text-sm flex items-center gap-1.5">
                    <span>{photo.title}</span>
                    {isProcessing && (
                      <span className="text-[9px] uppercase font-mono px-1.5 py-0.2 rounded bg-amber-200 text-amber-900 font-bold animate-pulse">
                        Analyzing
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    {isProcessing
                      ? 'Auditing clarity, hallmarking stamp & background purity...'
                      : isApproved
                      ? 'Quality standards passed & enhanced'
                      : isReshoot
                      ? 'Reshoot flag detected'
                      : 'Pending inspection slot'}
                  </div>
                </div>
              </div>

              <div className="shrink-0 pl-2">
                {isProcessing && <Loader2 className="w-5 h-5 text-red-600 animate-spin" />}
                {isApproved && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                {isReshoot && <AlertTriangle className="w-5 h-5 text-red-500" />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-[11px] text-stone-400 flex items-center justify-center gap-1.5 font-medium pt-1">
        <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
        <span>Strict RL Jewels Gold & Hallmarking Certification Standards</span>
      </div>
    </div>
  );
};
