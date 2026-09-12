import React, { useState } from 'react';
import { Sparkles, AlertCircle, ArrowRight, AlertTriangle } from 'lucide-react';
import { PhotoItem, GoldPurity, ProductGender, PreflightIssue } from '../types';

// The full taxonomy (673 ERP terms) is alphabetical, so a plain slice starts
// with obscure entries like "Abhishekpatra" - not useful as a quick-pick.
// These are the categories staff actually reach for most often at the
// counter; anything else can still be typed into the field below.
const COMMON_ITEM_TYPES = ['Ring', 'Chain', 'Necklace', 'Bangle', 'Earrings', 'Pendant', 'Bracelet', 'Mangalsutra'];
import { GuidanceBanner } from './GuidanceBanner';
import { PhotoSlotCard } from './PhotoSlotCard';
import { createJewelryPlaceholderSvg } from '../utils/sampleJewelry';

interface UploadPhotosStepProps {
  cpc: string;
  productName: string;
  itemType: string;
  setItemType: (val: string) => void;
  purity: GoldPurity;
  gender: ProductGender;
  netWeight: string;
  photo: PhotoItem;
  onUpdatePhoto: (dataUrl: string, options?: { isSample?: boolean }) => void;
  onRemovePhoto: () => void;
  onSubmitForProcessing: () => void;
}

export const UploadPhotosStep: React.FC<UploadPhotosStepProps> = ({
  cpc,
  productName,
  itemType,
  setItemType,
  purity,
  gender,
  netWeight,
  photo,
  onUpdatePhoto,
  onRemovePhoto,
  onSubmitForProcessing,
}) => {
  const isCaptured = Boolean(photo.originalImage);
  const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[]>([]);
  const [showQualityConfirm, setShowQualityConfirm] = useState(false);

  const handleLoadSample = () => {
    const sampleDataUrl = createJewelryPlaceholderSvg(purity, itemType || 'ring', photo.title);
    onUpdatePhoto(sampleDataUrl, { isSample: true });
  };

  // A photo the local quality check already flagged (blurry, too dark/
  // bright, jewelry too small in frame) is unfixable by enhancement no
  // matter which pipeline processes it - burns a full paid run for a doomed
  // result. Previously this warning was purely advisory and easy to miss;
  // now submitting a flagged photo requires an explicit confirmation
  // (PIPELINE_REBUILD_BRIEF.md shared blur/exposure-gate fix).
  const handleSubmitClick = () => {
    if (preflightIssues.length > 0) {
      setShowQualityConfirm(true);
      return;
    }
    onSubmitForProcessing();
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header Card */}
      <div className="bg-white border border-stone-200 rounded-3xl p-4 sm:p-5 shadow-xs">
        <span className="text-red-600 font-mono text-[11px] sm:text-xs uppercase tracking-widest font-bold">
          Step 01 • New Product
        </span>
        <h2 className="text-xl sm:text-2xl font-serif italic font-bold text-stone-900 mt-0.5">
          Capture the Photo
        </h2>
        <p className="text-xs text-stone-500 font-medium mt-1">
          Take the counter shot first - enhancement starts right away in the background, and you'll fill in the CPC, weight, and other details on the next screen while it runs.{' '}
          <strong className="text-stone-800">{isCaptured ? 'Photo Ready' : 'Awaiting Photo'}</strong>
        </p>

        {/* Category picker - kept here (not on the details screen) because the
            item type is what shapes the enhancement prompt, and processing
            starts the moment the photo is captured, before the details screen
            is ever seen. */}
        <div className="mt-3.5 pt-3.5 border-t border-stone-100">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">
            What type of piece is this? <span className="text-red-600">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {COMMON_ITEM_TYPES.map((suggestion) => {
              const isSelected = itemType.toLowerCase() === suggestion.toLowerCase();
              return (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setItemType(suggestion)}
                  className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                    isSelected
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200/80'
                  }`}
                >
                  {suggestion}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={itemType}
            onChange={(e) => setItemType(e.target.value)}
            placeholder="Or type a category (e.g. mangalsutra, kada, temple set...)"
            className="mt-2 min-h-[40px] w-full bg-stone-50/80 border border-stone-200 focus:border-red-600 focus:bg-white rounded-xl px-3.5 py-2 text-stone-900 text-sm placeholder:text-stone-400 focus:outline-none transition-all"
          />
        </div>
      </div>

      {/* On-screen photography guidance banner */}
      <GuidanceBanner />

      <div className="max-w-2xl mx-auto">
        <PhotoSlotCard
          photo={photo}
          onUpdateImage={onUpdatePhoto}
          onRemoveImage={onRemovePhoto}
          onLoadSample={handleLoadSample}
          onPreflightIssues={setPreflightIssues}
        />
      </div>

      {/* Action Footer */}
      <div className="bg-white border border-stone-200 rounded-3xl p-4 sm:p-5 sticky bottom-4 shadow-xl z-20 space-y-3">
        {(!isCaptured || !itemType.trim()) && (
          <div className="flex items-center gap-2 text-xs text-red-800 bg-red-50 border border-red-200 px-3.5 py-2.5 rounded-xl">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-medium">
              {!itemType.trim() ? 'Select a category above, and c' : 'C'}apture the product photo to continue.
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmitClick}
          disabled={!isCaptured || !itemType.trim()}
          className="w-full py-3.5 sm:py-4 px-6 rounded-2xl bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-md shadow-red-900/15 flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
        >
          <Sparkles className="w-5 h-5 text-amber-300" />
          <span>Start Enhancing & Continue</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {showQualityConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-stone-900">This Photo May Not Enhance Well</h3>
                <p className="text-sm text-stone-600 mt-1">
                  Enhancement can't fix a photo that's blurry, too dark/bright, or has the jewelry
                  too small in frame - submitting anyway means spending a full processing run on
                  a photo likely to need a reshoot regardless.
                </p>
              </div>
            </div>
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 space-y-1.5 text-sm">
              {preflightIssues.map((issue, idx) => (
                <div key={idx} className="flex items-start gap-2 text-stone-700">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowQualityConfirm(false)}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold text-sm transition-colors"
              >
                Retake Photo
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowQualityConfirm(false);
                  onSubmitForProcessing();
                }}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors"
              >
                Submit Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};