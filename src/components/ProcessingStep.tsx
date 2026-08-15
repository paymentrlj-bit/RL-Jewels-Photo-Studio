import React from 'react';
import { Sparkles, Loader2, ShieldCheck } from 'lucide-react';
import { PhotoItem, GoldPurity } from '../types';
import { BrandLogo } from './BrandLogo';

interface ProcessingStepProps {
  cpc: string;
  purity: GoldPurity;
  itemType: string;
  photo: PhotoItem;
}

export const ProcessingStep: React.FC<ProcessingStepProps> = ({ cpc, purity, itemType, photo }) => {
  return (
    <div className="max-w-2xl mx-auto bg-white border border-stone-200 rounded-3xl p-5 sm:p-8 text-stone-900 shadow-xs text-center space-y-6 my-4 sm:my-6 animate-in fade-in zoom-in duration-300">
      <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-red-100 animate-ping opacity-50" />
        <div className="absolute -inset-1 rounded-full border-2 border-dashed border-red-400 animate-spin [animation-duration:8s]" />
        <BrandLogo variant="3d-badge" size="md" className="relative z-10 animate-pulse-glow" />
      </div>

      <div className="space-y-1.5">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-bold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-spin [animation-duration:4s]" />
          <span>RL Jewels Studio</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-serif italic font-bold text-stone-900">
          Enhancing {cpc}
        </h2>
        <p className="text-xs sm:text-sm text-stone-500 max-w-md mx-auto">
          Cleaning background, correcting color, and checking quality on your {purity} {itemType} photo…
        </p>
      </div>

      <div className="bg-stone-50/80 border border-stone-200 rounded-2xl p-4 sm:p-6 flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl overflow-hidden bg-stone-900 shrink-0 border border-stone-200 relative">
          <img src={photo.originalImage} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-red-600/20 flex items-center justify-center">
            <div className="w-full h-0.5 bg-amber-300 animate-laser" />
          </div>
        </div>
        <div className="text-left">
          <div className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 text-red-600 animate-spin" />
            <span>Processing…</span>
          </div>
          <div className="text-[11px] text-stone-500 mt-0.5">
            This usually takes 10-30 seconds. A slower, higher-quality pass may run automatically if the first attempt needs a correction.
          </div>
        </div>
      </div>

      <div className="text-[11px] text-stone-400 flex items-center justify-center gap-1.5 font-medium pt-1">
        <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
        <span>Every photo still needs your final approval before export</span>
      </div>
    </div>
  );
};
