import React, { useState } from 'react';
import { ZapOff, Maximize, SunMedium, Eye, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';

export const GuidanceBanner: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-[#FAFAF9] border border-stone-200 rounded-2xl p-3.5 text-stone-700 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#B8860B]" />
          <h3 className="text-xs sm:text-sm font-bold text-stone-800 uppercase tracking-widest flex items-center gap-1.5">
            <span>Counter Photo Rules</span>
            <span className="text-[10px] text-stone-400 font-normal lowercase tracking-normal">(no light rig required)</span>
          </h3>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-stone-500 hover:text-stone-800 text-xs font-semibold flex items-center gap-1"
        >
          <span>{isExpanded ? 'Less' : 'Tips'}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* 3 Core Rules (Always Visible, Large Touch Badges) */}
      <div className="grid grid-cols-3 gap-2.5 mt-3">
        <div className="bg-white border border-stone-200 rounded-xl p-2.5 flex flex-col sm:flex-row items-center sm:items-start gap-2 text-center sm:text-left shadow-xs">
          <div className="w-7 h-7 rounded-full bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
            <ZapOff className="w-3.5 h-3.5 text-red-500" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-stone-800">1. Flash OFF</div>
            <p className="text-[10px] text-stone-500 hidden sm:block leading-tight">Prevents white glare on gold & diamonds</p>
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-2.5 flex flex-col sm:flex-row items-center sm:items-start gap-2 text-center sm:text-left shadow-xs">
          <div className="w-7 h-7 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
            <Maximize className="w-3.5 h-3.5 text-[#B8860B]" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-stone-800">2. Fill Frame</div>
            <p className="text-[10px] text-stone-500 hidden sm:block leading-tight">Jewelry takes 70% of screen</p>
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-2.5 flex flex-col sm:flex-row items-center sm:items-start gap-2 text-center sm:text-left shadow-xs">
          <div className="w-7 h-7 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <SunMedium className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-stone-800">3. No Spotlights</div>
            <p className="text-[10px] text-stone-500 hidden sm:block leading-tight">Don't shoot directly into lamps</p>
          </div>
        </div>
      </div>

      {/* Expanded detailed help */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-stone-200 text-xs space-y-2 text-stone-600">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[#B8860B] shrink-0 mt-0.5" />
            <p>
              <strong className="text-stone-900">Avoid Obstructions:</strong> Tuck or tape price tags and string behind the velvet pad so the AI doesn't reject the image.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Eye className="w-4 h-4 text-[#B8860B] shrink-0 mt-0.5" />
            <p>
              <strong className="text-stone-900">Hallmark Shot (BIS 916 / 750 / HUID):</strong> Hold the realme camera 5-7cm away, tap the screen once on the stamp to lock macro focus.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

