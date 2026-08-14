import React, { useRef, useState } from 'react';
import { Camera, Upload, Trash2, CheckCircle2, AlertTriangle, Eye, Sparkles, Image as ImageIcon } from 'lucide-react';
import { PhotoItem } from '../types';
import { CameraModal } from './CameraModal';

interface PhotoSlotCardProps {
  photo: PhotoItem;
  onUpdateImage: (id: string, dataUrl: string) => void;
  onRemoveImage: (id: string) => void;
  onLoadSample: (id: string) => void;
}

export const PhotoSlotCard: React.FC<PhotoSlotCardProps> = ({
  photo,
  onUpdateImage,
  onRemoveImage,
  onLoadSample,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        onUpdateImage(photo.id, event.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const hasImage = Boolean(photo.originalImage);

  return (
    <div
      className={`rounded-2xl border transition-all ${
        hasImage
          ? 'bg-white border-red-200 shadow-xs'
          : photo.required
          ? 'bg-white border-stone-200 hover:border-stone-300'
          : 'bg-[#FAFAF9] border-stone-200'
      } p-4 sm:p-5 flex flex-col justify-between`}
    >
      {/* Hidden Native File & Camera Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Header Info */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm sm:text-base text-stone-900">{photo.title}</span>
            {photo.required ? (
              <span className="text-[10px] uppercase font-bold bg-red-50 text-red-700 px-2 py-0.5 rounded-full border border-red-200">
                Required
              </span>
            ) : (
              <span className="text-[10px] uppercase text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">
                Optional
              </span>
            )}
          </div>
          <p className="text-xs text-stone-500 mt-1 leading-snug">{photo.description}</p>
        </div>

        {hasImage && (
          <div className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full text-xs font-semibold shrink-0 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Captured</span>
          </div>
        )}
      </div>

      {/* Image Preview or Capture Placeholder */}
      <div className="relative aspect-square sm:aspect-video w-full rounded-xl overflow-hidden bg-stone-50 border border-stone-200 flex items-center justify-center my-1.5">
        {hasImage ? (
          <>
            <img
              src={photo.originalImage}
              alt={photo.title}
              className="w-full h-full object-contain"
            />
            {/* Quick Actions Overlay */}
            <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowPreviewModal(true)}
                className="p-2 rounded-xl bg-white text-stone-800 hover:text-red-600 shadow-md transition-colors"
                title="Zoom View"
              >
                <Eye className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onRemoveImage(photo.id)}
                className="p-2 rounded-xl bg-white text-red-600 hover:text-red-800 shadow-md transition-colors"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : (
          <div className="text-center p-4 flex flex-col items-center justify-center space-y-2">
            <div className="w-11 h-11 rounded-full bg-white border border-stone-200 flex items-center justify-center text-stone-500 shadow-xs">
              <Camera className="w-5 h-5 text-red-600" />
            </div>
            <span className="text-xs text-stone-500 font-medium">Ready for Counter Camera</span>
          </div>
        )}
      </div>

      {/* Large Touch Action Buttons for Counter Staff */}
      <div className="mt-3 pt-2.5 border-t border-stone-100 flex items-center gap-2">
        {hasImage ? (
          <div className="w-full flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (cameraInputRef.current) cameraInputRef.current.click();
              }}
              className="min-h-[44px] flex-1 py-2.5 px-4 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold flex items-center justify-center gap-2 border border-stone-200 transition-colors uppercase tracking-wider"
            >
              <Camera className="w-4 h-4 text-red-600" />
              <span>Retake</span>
            </button>
            <button
              type="button"
              onClick={() => onRemoveImage(photo.id)}
              className="min-h-[44px] min-w-[44px] py-2.5 px-3.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold border border-red-200 transition-colors flex items-center justify-center"
              title="Delete Photo"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="w-full flex flex-col sm:flex-row items-stretch gap-2">
            {/* Primary Big Camera Launch */}
            <button
              type="button"
              onClick={() => {
                if (cameraInputRef.current) cameraInputRef.current.click();
              }}
              className="min-h-[44px] flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs active:scale-95 transition-all"
            >
              <Camera className="w-4 h-4 text-white" />
              <span>Camera Capture</span>
            </button>

            <div className="flex items-center gap-2 justify-center">
              {/* Secondary Upload */}
              <button
                type="button"
                onClick={() => {
                  if (fileInputRef.current) fileInputRef.current.click();
                }}
                className="min-h-[44px] px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                title="Browse Gallery"
              >
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">Upload</span>
              </button>

              {/* Sample Jewel Generator */}
              <button
                type="button"
                onClick={() => onLoadSample(photo.id)}
                className="min-h-[44px] px-3.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold flex items-center gap-1.5 transition-colors"
                title="Load Counter Sample Jewel"
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span className="hidden sm:inline">Sample</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Live Camera Viewfinder Modal */}
      <CameraModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        onCapture={(dataUrl) => onUpdateImage(photo.id, dataUrl)}
        title={`Capture: ${photo.title}`}
        isMacro={photo.type === 'macro_hallmark'}
      />

      {/* Zoom Preview Modal */}
      {showPreviewModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowPreviewModal(false)}
        >
          <div className="relative max-w-2xl max-h-[85vh] bg-white rounded-2xl p-3 border border-stone-200 shadow-2xl">
            <img
              src={photo.originalImage}
              alt={photo.title}
              className="max-w-full max-h-[75vh] object-contain rounded-xl"
            />
            <div className="text-center py-2 text-xs text-stone-600 font-medium">
              {photo.title} • Tap anywhere to close
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
