import React from 'react';
import { ChevronLeft, Sparkles, AlertCircle, ArrowRight, Camera, HelpCircle, Eye } from 'lucide-react';
import { PhotoItem, GoldPurity, ProductGender } from '../types';
import { GuidanceBanner } from './GuidanceBanner';
import { PhotoSlotCard } from './PhotoSlotCard';
import { createJewelryPlaceholderSvg } from '../utils/sampleJewelry';

interface UploadPhotosStepProps {
  cpc: string;
  productName: string;
  itemType: string;
  purity: GoldPurity;
  gender: ProductGender;
  grossWeight: string;
  netWeight: string;
  photos: PhotoItem[];
  onUpdatePhoto: (id: string, dataUrl: string) => void;
  onRemovePhoto: (id: string) => void;
  onBack: () => void;
  onSubmitForProcessing: () => void;
}

export const UploadPhotosStep: React.FC<UploadPhotosStepProps> = ({
  cpc,
  productName,
  itemType,
  purity,
  gender,
  grossWeight,
  netWeight,
  photos,
  onUpdatePhoto,
  onRemovePhoto,
  onBack,
  onSubmitForProcessing,
}) => {
  const [photoMode, setPhotoMode] = React.useState<'single' | 'multi'>('single');
  const heroPhoto = photos.find((p) => p.type === 'hero');
  const capturedCount = photos.filter((p) => Boolean(p.originalImage)).length;
  const isHeroCaptured = Boolean(heroPhoto?.originalImage);

  // Filter slots based on single vs multi angle mode
  const displayedPhotos = photoMode === 'single' 
    ? photos.filter((p) => p.type === 'hero')
    : photos;

  // Load sample jewel into slot matching itemType and exact angle
  const handleLoadSample = (id: string) => {
    const slot = photos.find((p) => p.id === id);
    if (!slot) return;
    const sampleDataUrl = createJewelryPlaceholderSvg(
      slot.type,
      purity,
      itemType || 'ring',
      slot.title
    );
    onUpdatePhoto(id, sampleDataUrl);
  };

  // Load sample for all empty slots
  const handleLoadAllSamples = () => {
    displayedPhotos.forEach((slot) => {
      const sampleDataUrl = createJewelryPlaceholderSvg(
        slot.type,
        purity,
        itemType || 'ring',
        slot.title
      );
      onUpdatePhoto(slot.id, sampleDataUrl);
    });
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Product Summary Header Card */}
      <div className="bg-white border border-stone-200 rounded-3xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors"
            title="Back to Product Form"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-sm sm:text-base text-red-700 bg-red-50 px-2.5 py-0.5 rounded-lg border border-red-200">
                {cpc}
              </span>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-900 font-bold border border-amber-300 uppercase tracking-wider">
                {purity}
              </span>
              <span className="text-xs text-stone-600 capitalize font-medium">
                {gender} • {itemType}
              </span>
              {netWeight && (
                <span className="text-xs text-emerald-800 font-mono font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Net: {netWeight}g
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 font-medium mt-1">
              {productName || `${purity} ${itemType}`} • Status: <strong className="text-stone-800">{isHeroCaptured ? '1 Photo Ready' : 'Awaiting Hero Photo'}</strong>
            </p>
          </div>
        </div>

        {/* Mode Selector & Quick Sample Filler */}
        <div className="flex items-center gap-2">
          <div className="bg-stone-100 p-1 rounded-xl border border-stone-200 flex items-center text-xs">
            <button
              type="button"
              onClick={() => setPhotoMode('single')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                photoMode === 'single'
                  ? 'bg-white text-stone-900 shadow-xs border border-stone-200'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              Single Photo
            </button>
            <button
              type="button"
              onClick={() => setPhotoMode('multi')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                photoMode === 'multi'
                  ? 'bg-white text-stone-900 shadow-xs border border-stone-200'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              All Angles (3+)
            </button>
          </div>

          <button
            type="button"
            onClick={handleLoadAllSamples}
            className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-3.5 py-2 rounded-xl flex items-center gap-1.5 font-bold transition-all shadow-xs active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Load Sample Photo</span>
          </button>
        </div>
      </div>

      {/* On-screen photography guidance banner */}
      <GuidanceBanner />

      {/* Grid of Photo Capture Slots */}
      <div className={photoMode === 'single' ? 'max-w-2xl mx-auto' : 'grid grid-cols-1 md:grid-cols-2 gap-4'}>
        {displayedPhotos.map((photo) => (
          <PhotoSlotCard
            key={photo.id}
            photo={photo}
            onUpdateImage={onUpdatePhoto}
            onRemoveImage={onRemovePhoto}
            onLoadSample={handleLoadSample}
          />
        ))}
      </div>

      {/* Action Footer */}
      <div className="bg-white border border-stone-200 rounded-3xl p-4 sm:p-5 sticky bottom-4 shadow-xl z-20 space-y-3">
        {!isHeroCaptured && (
          <div className="flex items-center gap-2 text-xs text-red-800 bg-red-50 border border-red-200 px-3.5 py-2.5 rounded-xl">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-medium">Please capture the single product photo to begin AI retouching & enhancement.</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="w-full sm:w-auto py-3.5 px-6 rounded-2xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors order-2 sm:order-1"
          >
            ← Back
          </button>

          <button
            type="button"
            onClick={onSubmitForProcessing}
            disabled={!isHeroCaptured}
            className="w-full flex-1 py-3.5 sm:py-4 px-6 rounded-2xl bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-md shadow-red-900/15 flex items-center justify-center gap-2 transition-all active:scale-[0.99] order-1 sm:order-2"
          >
            <Sparkles className="w-5 h-5 text-amber-300" />
            <span>Retouch & Enhance Photo with Gemini AI</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
