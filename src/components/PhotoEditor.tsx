// Rotate, straighten and crop a photo right after it is taken, before it is
// sent. Counter photos are often sideways or tilted; the AI draws a sideways
// piece sideways, so this is cheaper to fix here than after processing.
import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw, Check, X } from 'lucide-react';
import { applyEdits, renderTurned, type PhotoEdits } from '../utils/imageEdit';
import { FULL_CROP, MAX_STRAIGHTEN_DEG, clampCrop, type CropRect } from '../../server/catalog/imageEditMath';

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export const PhotoEditor: React.FC<{
  src: string;
  onDone: (edited: string) => void;
  onCancel: () => void;
}> = ({ src, onDone, onCancel }) => {
  const [quarterTurns, setQuarterTurns] = useState(0);
  const [straighten, setStraighten] = useState(0);
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [aspect, setAspect] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; startX: number; startY: number; start: CropRect } | null>(null);

  // A small live preview; the full-size edit is only made on "Done".
  useEffect(() => {
    let cancelled = false;
    renderTurned(src, { quarterTurns, straighten }, 900)
      .then((canvas) => {
        if (cancelled) return;
        setAspect(canvas.width / canvas.height);
        setPreviewUrl(canvas.toDataURL('image/jpeg', 0.8));
      })
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [src, quarterTurns, straighten]);

  const turn = (dir: 1 | -1) => {
    setQuarterTurns((q) => (q + dir + 4) % 4);
    setCrop(FULL_CROP); // a crop drawn on the old orientation no longer means anything
  };

  const onPointerDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, start: crop };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || !box) return;
    const rect = box.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / rect.width;
    const dy = (e.clientY - d.startY) / rect.height;
    const s = d.start;
    if (d.handle === 'move') {
      setCrop(clampCrop({ ...s, x: s.x + dx, y: s.y + dy }));
      return;
    }
    let { x, y, w, h } = s;
    if (d.handle === 'nw' || d.handle === 'sw') { x = s.x + dx; w = s.w - dx; }
    if (d.handle === 'ne' || d.handle === 'se') { w = s.w + dx; }
    if (d.handle === 'nw' || d.handle === 'ne') { y = s.y + dy; h = s.h - dy; }
    if (d.handle === 'sw' || d.handle === 'se') { h = s.h + dy; }
    setCrop(clampCrop({ x, y, w, h }));
  };

  const done = async () => {
    setSaving(true);
    try {
      const edits: PhotoEdits = { quarterTurns, straighten, crop };
      onDone(await applyEdits(src, edits));
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const handleClass = 'absolute h-7 w-7 rounded-full border-2 border-white bg-amber-500 shadow touch-none';
  const pct = (n: number) => `${n * 100}%`;

  return (
    <div role="dialog" aria-modal="true" aria-label="Rotate and crop photo" className="fixed inset-0 z-50 flex flex-col bg-stone-950 text-white">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={onCancel} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm hover:bg-white/10">
          <X className="w-4 h-4" /> Cancel
        </button>
        <p className="text-sm font-medium">Rotate and crop</p>
        <button
          type="button"
          onClick={done}
          disabled={saving || !previewUrl}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-amber-500 px-4 text-sm font-medium text-stone-900 hover:bg-amber-400 disabled:opacity-60"
        >
          <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Done'}
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
        {previewUrl && (
          <div
            ref={boxRef}
            className="relative select-none"
            // As large as fits between the toolbar and the controls, whatever the shape.
            style={{ aspectRatio: String(aspect), width: `min(100%, calc((100dvh - 230px) * ${aspect}))` }}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <img src={previewUrl} alt="Photo being edited" draggable={false} className="h-full w-full object-fill" />
            {/* Everything outside the crop is dimmed. */}
            <div
              className="absolute border-2 border-white touch-none cursor-move"
              style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h), boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
              onPointerDown={onPointerDown('move')}
            >
              <span className={`${handleClass} -left-3.5 -top-3.5 cursor-nwse-resize`} onPointerDown={onPointerDown('nw')} />
              <span className={`${handleClass} -right-3.5 -top-3.5 cursor-nesw-resize`} onPointerDown={onPointerDown('ne')} />
              <span className={`${handleClass} -bottom-3.5 -left-3.5 cursor-nesw-resize`} onPointerDown={onPointerDown('sw')} />
              <span className={`${handleClass} -bottom-3.5 -right-3.5 cursor-nwse-resize`} onPointerDown={onPointerDown('se')} />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 px-4 pb-5 pt-2">
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={() => turn(-1)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/20">
            <RotateCcw className="w-4 h-4" /> Turn left
          </button>
          <button type="button" onClick={() => turn(1)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/20">
            <RotateCw className="w-4 h-4" /> Turn right
          </button>
          <button type="button" onClick={() => setCrop(FULL_CROP)} className="min-h-[44px] rounded-lg px-3 text-sm text-white/80 hover:bg-white/10">
            Reset crop
          </button>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-20 shrink-0 text-white/80">Straighten</span>
          <input
            type="range"
            min={-MAX_STRAIGHTEN_DEG}
            max={MAX_STRAIGHTEN_DEG}
            step={0.5}
            value={straighten}
            onChange={(e) => setStraighten(Number(e.target.value))}
            className="h-11 flex-1 accent-amber-500"
            aria-label="Straighten the photo"
          />
          <span className="w-12 shrink-0 text-right tabular-nums text-white/80">{straighten.toFixed(1)}°</span>
        </label>
      </div>
    </div>
  );
};
