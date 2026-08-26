import React, { useState, useEffect } from 'react';
import { GitBranch, X, Check, Loader2, ShieldCheck, Sparkles, Lock } from 'lucide-react';

interface AdminPipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ActivePipeline = 'old' | 'new';

// Phase 1 of PIPELINE_REBUILD_BRIEF.md - the toggle scaffold ships before the
// new deterministic-first pipeline exists, so 'new' is shown but disabled
// rather than hidden: admins should be able to see it's coming, not wonder
// why it's simply not there. Selecting it is rejected server-side with a
// clear reason (see /api/admin/pipeline in server.ts) rather than silently
// doing nothing, consistent with this app's "never a silent no-op" stance.
export const AdminPipelineModal: React.FC<AdminPipelineModalProps> = ({ isOpen, onClose }) => {
  const [activePipeline, setActivePipeline] = useState<ActivePipeline>('old');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoadError('');
      setSaveError('');
      setSavedMsg(false);
      setLoading(true);
      fetch('/api/admin/pipeline')
        .then((res) => res.json())
        .then((data) => {
          if (data.activePipeline === 'old' || data.activePipeline === 'new') {
            setActivePipeline(data.activePipeline);
          }
        })
        .catch(() => {
          setLoadError('Could not load the current pipeline setting from the server.');
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelect = async (pipeline: ActivePipeline) => {
    if (pipeline === activePipeline || saving || loading) return;
    setSaveError('');
    setSaving(true);
    try {
      const res = await fetch('/api/admin/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activePipeline: pipeline }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || 'Could not change the pipeline.');
        return;
      }
      setActivePipeline(data.activePipeline);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } catch {
      setSaveError('Save failed - could not reach the server. The pipeline was not changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white border border-stone-200 rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] my-auto">

        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-stone-200 flex items-center justify-between bg-stone-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center shadow-xs">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-stone-900 text-base sm:text-lg">
                  Processing Pipeline
                </h3>
                <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border border-amber-300">
                  Admin Master Studio
                </span>
              </div>
              <p className="text-xs text-stone-500 font-medium">
                Which pipeline processes every new photo submitted from now on.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {savedMsg && (
          <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs px-4 py-2.5 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span className="font-bold">Saved - all new photo submissions will use this pipeline. Photos already processed are untouched.</span>
          </div>
        )}

        {(loadError || saveError) && (
          <div className="bg-red-50 border-b border-red-200 text-red-800 text-xs px-4 py-2.5 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-bold">{loadError || saveError}</span>
          </div>
        )}

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-3 flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-stone-400 animate-spin" />
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleSelect('old')}
                disabled={saving}
                className={`w-full text-left p-4 rounded-2xl border-2 transition-all disabled:opacity-60 ${
                  activePipeline === 'old'
                    ? 'border-red-600 bg-red-50/60 shadow-xs'
                    : 'border-stone-200 hover:border-stone-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 text-sm flex items-center gap-2">
                    Studio AI Pipeline (Current)
                    {activePipeline === 'old' && <Check className="w-4 h-4 text-red-600" />}
                  </span>
                </div>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                  Single AI model enhances the full photo, self-audits the result, and escalates
                  to a stronger model once if a fixable quality issue is found. Live and fully
                  fixed per PIPELINE_REBUILD_BRIEF.md Section 5.
                </p>
              </button>

              <button
                type="button"
                disabled
                title="Not built yet - see PIPELINE_REBUILD_BRIEF.md Phase 2+"
                className="w-full text-left p-4 rounded-2xl border-2 border-stone-200 bg-stone-50 opacity-60 cursor-not-allowed"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-700 text-sm flex items-center gap-2">
                    Deterministic-First Pipeline
                    <Lock className="w-3.5 h-3.5 text-stone-400" />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 bg-stone-200 px-2 py-0.5 rounded-full">
                    Coming Soon
                  </span>
                </div>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                  Real pixel-level matte extraction and compositing instead of a generative
                  model touching the jewelry's own pixels - no AI can add, remove, or resize a
                  design detail on this path. Not built yet (Phase 2+).
                </p>
              </button>

              <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-3.5 text-xs text-amber-900 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  This is a studio-wide switch, not a per-photo choice. Changing it only affects
                  photos submitted after the change - anything already processed stays as-is.
                </span>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-stone-200 bg-stone-50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold text-xs uppercase tracking-wider transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
