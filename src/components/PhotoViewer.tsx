// Full-screen photo viewer for Review. The card thumbnails are too small to
// judge beads or stones, and pinching on a phone is fiddly - so a tap opens the
// photo as large as the screen allows, a button zooms in without pinching, and
// the tabs flip between Original / Studio / Real photo in the same spot so the
// eye can compare them.
import React, { useEffect, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';

export interface ViewerPhoto {
  label: string;
  url: string;
}

export const PhotoViewer: React.FC<{
  photos: ViewerPhoto[];
  startIndex?: number;
  onClose: () => void;
}> = ({ photos, startIndex = 0, onClose }) => {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(photos.length - 1, 0)));
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, photos.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, photos.length]);

  const photo = photos[index];
  if (!photo) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={`${photo.label} photo, full size`} className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between px-3 py-2 text-white">
        <p className="text-sm font-medium">{photo.label}</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            aria-pressed={zoomed}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm hover:bg-white/10"
          >
            {zoomed ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />} {zoomed ? 'Fit' : 'Zoom in'}
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Zoomed: the image is drawn at 2.5x the screen width and scrolls. */}
      <div className={`flex-1 overflow-auto ${zoomed ? '' : 'flex items-center justify-center'}`}>
        <img
          src={photo.url}
          alt={`${photo.label} photo`}
          className={zoomed ? 'max-w-none' : 'max-h-full max-w-full object-contain'}
          style={zoomed ? { width: '250vw' } : undefined}
        />
      </div>

      {photos.length > 1 && (
        <div className="flex justify-center gap-2 px-3 py-3">
          {photos.map((p, i) => (
            <button
              key={p.url}
              type="button"
              onClick={() => setIndex(i)}
              aria-pressed={i === index}
              className={`min-h-[44px] rounded-lg px-4 text-sm ${i === index ? 'bg-white text-stone-900' : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
