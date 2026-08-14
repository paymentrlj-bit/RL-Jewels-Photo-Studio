import React, { useState } from 'react';
import { X, Sparkles, Loader2, Check, RefreshCw, Palette, Layers, User } from 'lucide-react';
import { PhotoItem, TryonConfig, GoldPurity, ProductGender } from '../types';

interface ModelTryonModalProps {
  isOpen: boolean;
  onClose: () => void;
  photo: PhotoItem | null;
  sku: string;
  itemType: string;
  purity: GoldPurity;
  gender: ProductGender;
  onSaveTryonImage: (photoId: string, tryonDataUrl: string, config: TryonConfig) => void;
}

export const ModelTryonModal: React.FC<ModelTryonModalProps> = ({
  isOpen,
  onClose,
  photo,
  sku,
  itemType,
  purity,
  gender,
  onSaveTryonImage,
}) => {
  const [skinTone, setSkinTone] = useState<TryonConfig['skinTone']>('Warm Golden Indian');
  const [backdrop, setBackdrop] = useState<TryonConfig['backdrop']>('Traditional Festive & Velvet');
  const [modelGender, setModelGender] = useState<ProductGender>(gender || "women's");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedTryonUrl, setGeneratedTryonUrl] = useState<string | null>(photo?.tryonImage || null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !photo) return null;

  const skinToneOptions: { label: TryonConfig['skinTone']; colorClass: string; desc: string }[] = [
    { label: 'Warm Golden Indian', colorClass: 'bg-[#C68A4C]', desc: 'Warm undertone standard' },
    { label: 'Wheatish Medium', colorClass: 'bg-[#D2A06E]', desc: 'Subtle sun-kissed' },
    { label: 'Fair Olive', colorClass: 'bg-[#E5B887]', desc: 'Lighter porcelain/olive' },
    { label: 'Deep Rich Dusky', colorClass: 'bg-[#8D5524]', desc: 'Rich melanin radiance' },
  ];

  const backdropOptions: { label: TryonConfig['backdrop']; desc: string; iconColor: string }[] = [
    { label: 'Traditional Festive & Velvet', desc: 'Maroon velvet & bridal warmth', iconColor: 'text-red-400' },
    { label: 'Modern Pastel Studio', desc: 'Soft blush cream high-fashion', iconColor: 'text-amber-300' },
    { label: 'Royal Heritage Silk', desc: 'Deep emerald & gold palace aesthetic', iconColor: 'text-emerald-400' },
    { label: 'Minimalist Luxury Pure', desc: 'Architectural neutral studio lighting', iconColor: 'text-stone-300' },
  ];

  const handleGenerateTryon = async () => {
    setIsGenerating(true);
    setErrorMsg(null);

    const sourceImage = photo.processedImage || photo.originalImage;

    try {
      const response = await fetch('/api/generate-tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: sourceImage,
          itemType,
          purity,
          gender: modelGender,
          skinTone,
          backdropStyle: backdrop,
          modelGender,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json();
      if (data.tryonImageBase64) {
        setGeneratedTryonUrl(data.tryonImageBase64);
      } else {
        throw new Error('No image returned from Gemini generator');
      }
    } catch (err: any) {
      console.error('Tryon generation error:', err);
      setErrorMsg(err.message || 'Failed to generate try-on. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyAndClose = () => {
    if (generatedTryonUrl && photo) {
      onSaveTryonImage(photo.id, generatedTryonUrl, {
        skinTone,
        backdrop,
        modelGender,
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white border border-stone-200 rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl text-stone-900">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
              <Sparkles className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h3 className="font-serif italic font-bold text-lg sm:text-xl text-stone-900">
                Virtual Model Try-On
              </h3>
              <p className="text-xs text-stone-500 font-medium">
                Generate editorial lifestyle styling for {sku} ({purity} {itemType})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-stone-100 text-stone-500 hover:text-stone-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          
          {/* Main Visual Comparison / Preview Area */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Reference Approved Jewelry */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider">
                Approved Jewelry Source
              </span>
              <div className="aspect-square bg-stone-50 border border-stone-200 rounded-2xl overflow-hidden flex items-center justify-center p-3 shadow-xs">
                <img
                  src={photo.processedImage || photo.originalImage}
                  alt="Source"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            {/* Generated Model Visualization */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-red-700 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Styled Visualization</span>
                </span>
                {generatedTryonUrl && (
                  <span className="text-[10px] bg-amber-50 text-amber-900 border border-amber-300 px-2 py-0.5 rounded font-mono font-bold">
                    AI Rendered
                  </span>
                )}
              </div>

              <div className="relative aspect-square bg-stone-50 border border-stone-200 rounded-2xl overflow-hidden flex items-center justify-center shadow-xs">
                {isGenerating ? (
                  <div className="p-4 text-center space-y-3">
                    <Loader2 className="w-8 h-8 text-red-600 animate-spin mx-auto" />
                    <div className="text-xs text-stone-900 font-bold">
                      Rendering model wearing {purity} {itemType}...
                    </div>
                    <p className="text-[11px] text-stone-500">
                      Fitting skin tone ({skinTone}) & backdrop
                    </p>
                  </div>
                ) : generatedTryonUrl ? (
                  <>
                    <img
                      src={generatedTryonUrl}
                      alt="Styled Tryon"
                      className="w-full h-full object-cover"
                    />

                    {/* MANDATORY "Styled Visualization" BADGE in Corner */}
                    <div className="absolute top-2.5 right-2.5 bg-white/95 backdrop-blur-xs border border-amber-300 text-amber-900 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase shadow-xs flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      <span>Styled Visualization</span>
                    </div>

                    <div className="absolute bottom-2.5 left-2.5 right-2.5 bg-white/90 backdrop-blur-xs border border-stone-200 px-2.5 py-1 rounded-lg text-[10px] text-stone-700 text-center font-medium shadow-xs">
                      {skinTone} • {backdrop}
                    </div>
                  </>
                ) : (
                  <div className="p-4 text-center space-y-2 text-stone-400">
                    <User className="w-8 h-8 mx-auto text-stone-300" />
                    <p className="text-xs font-medium text-stone-500">Choose presets below and tap Generate</p>
                  </div>
                )}
              </div>
            </div>

          </div>

          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 p-3 rounded-xl">
              {errorMsg}
            </div>
          )}

          {/* Preset Customizers */}
          <div className="space-y-4 pt-2 border-t border-stone-100">
            
            {/* 1. Skin Tone Range */}
            <div>
              <label className="block text-xs font-bold text-stone-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-red-600" />
                <span>Model Skin Tone Preset</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {skinToneOptions.map((opt) => {
                  const isSelected = skinTone === opt.label;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setSkinTone(opt.label)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-red-50 border-red-600 text-stone-900 shadow-xs ring-1 ring-red-600/30'
                          : 'bg-white border-stone-200 text-stone-700 hover:border-stone-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-3.5 h-3.5 rounded-full ${opt.colorClass} ring-1 ring-stone-300`} />
                        <span className="text-xs font-bold leading-tight">{opt.label}</span>
                      </div>
                      <span className="text-[10px] text-stone-500 block leading-tight">{opt.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Backdrop Style */}
            <div>
              <label className="block text-xs font-bold text-stone-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-red-600" />
                <span>Setting & Backdrop Aesthetic</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {backdropOptions.map((opt) => {
                  const isSelected = backdrop === opt.label;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setBackdrop(opt.label)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-red-50 border-red-600 text-stone-900 shadow-xs ring-1 ring-red-600/30'
                          : 'bg-white border-stone-200 text-stone-700 hover:border-stone-300'
                      }`}
                    >
                      <div className="text-xs font-bold text-stone-900">{opt.label}</div>
                      <div className="text-[10px] text-stone-500 mt-0.5">{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Model Gender */}
            <div>
              <label className="block text-xs font-bold text-stone-900 uppercase tracking-wider mb-2">
                Model Gender
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(["women's", "men's", 'unisex', "kids'"] as ProductGender[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setModelGender(g)}
                    className={`py-2 px-2 rounded-xl text-center border capitalize text-xs font-bold transition-all ${
                      modelGender === g
                        ? 'bg-red-600 text-white border-red-600 shadow-xs'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-stone-300'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

          </div>

        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-stone-100 bg-stone-50 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto py-2.5 px-4 rounded-xl bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 text-xs font-bold uppercase tracking-wider order-2 sm:order-1 transition-colors"
          >
            Cancel
          </button>

          <div className="w-full sm:w-auto flex items-center gap-2 order-1 sm:order-2">
            {/* Generate / Regenerate Button */}
            <button
              type="button"
              onClick={handleGenerateTryon}
              disabled={isGenerating}
              className="flex-1 sm:flex-initial py-3 px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 shadow-xs"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 text-amber-300" />
              )}
              <span>{generatedTryonUrl ? 'Re-Generate Style' : 'Generate Model Try-On'}</span>
            </button>

            {/* Save to Product Package Button */}
            {generatedTryonUrl && (
              <button
                type="button"
                onClick={handleApplyAndClose}
                className="flex-1 sm:flex-initial py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider shadow-xs flex items-center justify-center gap-1.5 transition-all"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>Save to Package</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
