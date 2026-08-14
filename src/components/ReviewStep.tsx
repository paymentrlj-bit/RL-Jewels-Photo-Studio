import React, { useState, useRef } from 'react';
import {
  Check,
  RefreshCw,
  Trash2,
  Sparkles,
  AlertTriangle,
  Camera,
  ArrowRight,
  ChevronLeft,
  Eye,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Maximize2
} from 'lucide-react';
import { PhotoItem, GoldPurity, ProductGender, ReviewDecision, TryonConfig } from '../types';
import { ModelTryonModal } from './ModelTryonModal';
import { retouchJewelryPhoto } from '../utils/studioRetoucher';
import { Sliders, Sun, Shield } from 'lucide-react';

interface ReviewStepProps {
  sku: string;
  cpc?: string;
  productName: string;
  itemType: string;
  purity: GoldPurity;
  gender: ProductGender;
  photos: PhotoItem[];
  onUpdateReviewDecision: (photoId: string, decision: ReviewDecision) => void;
  onRegeneratePhoto: (photoId: string) => void;
  onRetakePhoto: (photoId: string, newDataUrl: string) => void;
  onSaveTryonImage: (photoId: string, tryonUrl: string, config: TryonConfig) => void;
  onBackToPhotos: () => void;
  onProceedToExport: () => void;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  sku,
  cpc,
  productName,
  itemType,
  purity,
  gender,
  photos,
  onUpdateReviewDecision,
  onRegeneratePhoto,
  onRetakePhoto,
  onSaveTryonImage,
  onBackToPhotos,
  onProceedToExport,
}) => {
  const displayCpc = cpc || sku;
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [comparisonMode, setComparisonMode] = useState<'split' | 'processed' | 'original'>('split');
  const [tryonModalPhoto, setTryonModalPhoto] = useState<PhotoItem | null>(null);
  const retakeInputRef = useRef<HTMLInputElement | null>(null);

  const activePhotos = photos.filter((p) => Boolean(p.originalImage));
  const currentPhoto = activePhotos[selectedPhotoIndex] || activePhotos[0];

  const approvedCount = activePhotos.filter((p) => p.reviewDecision === 'approved' || (p.status === 'approved' && p.reviewDecision !== 'discarded')).length;
  const needsReshootCount = activePhotos.filter((p) => p.status === 'needs_reshoot').length;

  const handleRetakeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentPhoto) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        onRetakePhoto(currentPhoto.id, event.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  if (!currentPhoto) {
    return (
      <div className="p-6 text-center text-stone-700 bg-white rounded-3xl border border-stone-200">
        <p>No photos available for review.</p>
        <button
          onClick={onBackToPhotos}
          className="mt-4 px-4 py-2 bg-red-600 text-white font-bold rounded-xl"
        >
          Return to Photo Capture
        </button>
      </div>
    );
  }

  const isReshoot = currentPhoto.status === 'needs_reshoot';
  const isApproved = currentPhoto.status === 'approved';
  const decision = currentPhoto.reviewDecision;

  return (
    <div className="space-y-4">
      {/* Hidden File Input for 1-Tap Retake */}
      <input
        ref={retakeInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleRetakeFile}
        className="hidden"
      />

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
            <p className="text-xs text-stone-500 font-medium mt-0.5">
              Reviewing {selectedPhotoIndex + 1} of {activePhotos.length}: <strong className="text-stone-900">{currentPhoto.title}</strong>
            </p>
          </div>
        </div>

        {/* Status Pills */}
        <div className="flex items-center gap-2 text-xs">
          <span className="px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{approvedCount} Ready</span>
          </span>
          {needsReshootCount > 0 && (
            <span className="px-3 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{needsReshootCount} Reshoot</span>
            </span>
          )}
        </div>
      </div>

      {/* Horizontal Carousel Thumbnails of All Photos */}
      <div className="flex items-center gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
        {activePhotos.map((photo, idx) => {
          const isSelected = idx === selectedPhotoIndex;
          const photoIsReshoot = photo.status === 'needs_reshoot';
          const photoIsApproved = photo.reviewDecision === 'approved' || (photo.status === 'approved' && photo.reviewDecision !== 'discarded');

          return (
            <button
              key={photo.id}
              type="button"
              onClick={() => setSelectedPhotoIndex(idx)}
              className={`flex items-center gap-2.5 p-2 rounded-xl border shrink-0 transition-all ${
                isSelected
                  ? 'bg-red-50 border-red-600 ring-2 ring-red-600/20 shadow-xs'
                  : 'bg-white border-stone-200 hover:border-stone-300'
              }`}
            >
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-stone-50 border border-stone-200">
                <img
                  src={photo.processedImage || photo.originalImage}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="text-left pr-2">
                <div className="text-[11px] font-bold text-stone-900 truncate max-w-[80px]">
                  {photo.title}
                </div>
                <div className="text-[10px]">
                  {photoIsReshoot ? (
                    <span className="text-red-600 font-bold">Reshoot</span>
                  ) : photoIsApproved ? (
                    <span className="text-emerald-600 font-bold">Approved</span>
                  ) : (
                    <span className="text-stone-400">Pending</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Review Visual Box */}
      {isReshoot ? (
        /* Needs Reshoot State */
        <div className="bg-white border-2 border-red-200 rounded-3xl p-5 sm:p-7 text-stone-900 space-y-4 shadow-xs">
          
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 p-4 rounded-2xl">
            <AlertTriangle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-serif italic font-bold text-base sm:text-lg text-red-900">
                Quality Audit: Reshoot Required
              </h3>
              <p className="text-xs sm:text-sm text-stone-700 mt-1 leading-relaxed">
                <strong>Reason:</strong> {currentPhoto.reshootReason || 'Photo obstructed or out of focus.'}
              </p>
              <p className="text-[11px] text-stone-500 mt-1">
                Store policy: Defective, blurry, or tag-obscured photos cannot be exported to the ERP catalog.
              </p>
            </div>
          </div>

          {/* Original with flaw callout */}
          <div className="max-w-md mx-auto aspect-square bg-stone-50 rounded-2xl overflow-hidden border border-stone-200 relative flex items-center justify-center">
            <img
              src={currentPhoto.originalImage}
              alt="Raw Counter Photo"
              className="w-full h-full object-contain"
            />
            <div className="absolute top-3 left-3 bg-red-600 text-white px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider shadow-xs">
              Flagged Capture
            </div>
          </div>

          {/* Action to Retake */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                if (retakeInputRef.current) retakeInputRef.current.click();
              }}
              className="w-full sm:w-auto py-3.5 px-8 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-xs flex items-center justify-center gap-2 transition-all"
            >
              <Camera className="w-4 h-4 text-white" />
              <span>Retake This Angle Now</span>
            </button>
            <button
              type="button"
              onClick={() => onRegeneratePhoto(currentPhoto.id)}
              className="w-full sm:w-auto py-3.5 px-6 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs sm:text-sm font-bold uppercase tracking-wider border border-stone-200 flex items-center justify-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 text-stone-500" />
              <span>Re-Audit with AI</span>
            </button>
          </div>
        </div>
      ) : (
        /* Approved / Studio Enhanced State */
        <div className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-7 space-y-5 shadow-xs text-stone-900">
          
          {/* View Toggle (Side by Side vs Full) */}
          <div className="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="font-serif italic font-bold text-lg text-stone-900">
                {currentPhoto.title}
              </span>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full border border-emerald-200 font-bold uppercase tracking-wider">
                Studio E-Commerce Grade
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!currentPhoto.originalImage) return;
                  const polished = await retouchJewelryPhoto(currentPhoto.originalImage, {
                    purity,
                    itemType,
                    goldWarmth: 1.05,
                  });
                  onRetakePhoto(currentPhoto.id, currentPhoto.originalImage);
                  // Update processed image directly
                  currentPhoto.processedImage = polished;
                  onUpdateReviewDecision(currentPhoto.id, 'approved');
                }}
                className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 transition-all"
                title="Re-run Studio Background Isolation & Gold Calibration"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Re-Polish White Studio</span>
              </button>

              <div className="flex items-center bg-stone-100 rounded-xl p-1 border border-stone-200 text-xs">
                <button
                  onClick={() => setComparisonMode('split')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    comparisonMode === 'split' ? 'bg-red-600 text-white shadow-xs' : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Split View
                </button>
                <button
                  onClick={() => setComparisonMode('processed')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    comparisonMode === 'processed' ? 'bg-red-600 text-white shadow-xs' : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Studio AI
                </button>
                <button
                  onClick={() => setComparisonMode('original')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    comparisonMode === 'original' ? 'bg-red-600 text-white shadow-xs' : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Raw
                </button>
              </div>
            </div>
          </div>

          {/* Photo Display Canvas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Left / Enhanced Studio Image */}
            {(comparisonMode === 'split' || comparisonMode === 'processed') && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-stone-800 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>RL Jewels Studio Cleaned</span>
                  </span>
                  <span className="text-[10px] text-stone-400 font-medium">Pure Pedestal / High Dynamic Contrast</span>
                </div>
                <div className="aspect-square bg-stone-50 border border-stone-200 rounded-2xl overflow-hidden flex items-center justify-center p-3 relative group shadow-xs">
                  <img
                    src={currentPhoto.processedImage || currentPhoto.originalImage}
                    alt="Processed"
                    className="w-full h-full object-contain"
                  />
                  {/* Subtle Badge */}
                  <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-xs border border-amber-300 text-amber-900 text-[10px] px-2.5 py-0.5 rounded-md font-mono font-bold shadow-xs">
                    {purity} Gold Enhanced
                  </div>
                </div>
              </div>
            )}

            {/* Right / Original Counter Shot */}
            {(comparisonMode === 'split' || comparisonMode === 'original') && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-stone-600">Raw Counter Photo</span>
                  <span className="text-[10px] text-stone-400 font-medium">realme NARZO 90x 5G</span>
                </div>
                <div className="aspect-square bg-stone-50 border border-stone-200 rounded-2xl overflow-hidden flex items-center justify-center p-3 shadow-xs">
                  <img
                    src={currentPhoto.originalImage}
                    alt="Original Raw"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )}

          </div>

          {/* Optional Virtual Try-On Badge if exists */}
          {currentPhoto.tryonImage && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-amber-200 shrink-0 shadow-xs">
                  <img src={currentPhoto.tryonImage} alt="Tryon" className="w-full h-full object-cover" />
                </div>
                <div>
                  <div className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>Attached Styled Model Visualization</span>
                  </div>
                  <div className="text-[11px] text-stone-500">
                    {currentPhoto.tryonSettings?.skinTone} • {currentPhoto.tryonSettings?.backdrop}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTryonModalPhoto(currentPhoto)}
                className="text-xs text-amber-900 hover:text-amber-950 bg-white px-3 py-1.5 rounded-lg border border-amber-300 font-bold shadow-xs transition-colors"
              >
                Change Style
              </button>
            </div>
          )}

          {/* 3 Core Action Buttons: Approve, Regenerate, Discard */}
          <div className="pt-3 border-t border-stone-100 space-y-3">
            <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
              
              {/* 1. APPROVE BUTTON */}
              <button
                type="button"
                onClick={() => {
                  onUpdateReviewDecision(currentPhoto.id, 'approved');
                  if (selectedPhotoIndex < activePhotos.length - 1) {
                    setSelectedPhotoIndex(selectedPhotoIndex + 1);
                  }
                }}
                className={`py-3.5 px-3 rounded-xl font-bold text-xs sm:text-sm uppercase tracking-wider flex flex-col sm:flex-row items-center justify-center gap-2 transition-all ${
                  decision === 'approved'
                    ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-400'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                }`}
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>Approve</span>
              </button>

              {/* 2. REGENERATE BUTTON */}
              <button
                type="button"
                onClick={() => onRegeneratePhoto(currentPhoto.id)}
                className="py-3.5 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 font-bold text-xs sm:text-sm uppercase tracking-wider flex flex-col sm:flex-row items-center justify-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 text-stone-500" />
                <span>Regenerate</span>
              </button>

              {/* 3. DISCARD / RETAKE BUTTON */}
              <button
                type="button"
                onClick={() => {
                  if (retakeInputRef.current) retakeInputRef.current.click();
                }}
                className="py-3.5 px-3 rounded-xl bg-stone-100 hover:bg-red-50 hover:text-red-700 hover:border-red-200 text-stone-700 border border-stone-200 font-bold text-xs sm:text-sm uppercase tracking-wider flex flex-col sm:flex-row items-center justify-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>Discard / Retake</span>
              </button>
            </div>

            {/* Optional "Generate Model Try-On" button */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setTryonModalPhoto(currentPhoto)}
                className="w-full py-3 px-4 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-300 text-amber-900 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-xs"
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span>
                  {currentPhoto.tryonImage ? 'Edit Styled Model Try-On' : 'Generate Model Try-On for this Piece'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Navigation Bar */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (selectedPhotoIndex > 0) setSelectedPhotoIndex(selectedPhotoIndex - 1);
            }}
            disabled={selectedPhotoIndex === 0}
            className="py-3 px-4 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-40 text-stone-700 text-xs font-bold uppercase tracking-wider transition-colors"
          >
            ← Previous
          </button>

          <button
            type="button"
            onClick={() => {
              if (selectedPhotoIndex < activePhotos.length - 1) {
                setSelectedPhotoIndex(selectedPhotoIndex + 1);
              }
            }}
            disabled={selectedPhotoIndex === activePhotos.length - 1}
            className="py-3 px-4 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-40 text-stone-700 text-xs font-bold uppercase tracking-wider transition-colors"
          >
            Next →
          </button>
        </div>

        {/* Proceed to Export Button */}
        <button
          type="button"
          onClick={onProceedToExport}
          className="w-full sm:w-auto py-3.5 sm:py-4 px-8 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-md shadow-red-900/15 flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
        >
          <span>Finalize & Export ({approvedCount} Approved)</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Model Try-On Modal */}
      <ModelTryonModal
        isOpen={Boolean(tryonModalPhoto)}
        onClose={() => setTryonModalPhoto(null)}
        photo={tryonModalPhoto}
        sku={sku}
        itemType={itemType}
        purity={purity}
        gender={gender}
        onSaveTryonImage={onSaveTryonImage}
      />
    </div>
  );
};
