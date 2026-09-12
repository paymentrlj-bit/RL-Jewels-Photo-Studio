import React, { useState, useEffect } from 'react';
import { Sparkles, X, Check, RotateCcw, Copy, Sliders, ShieldCheck, FileText, Info, Loader2 } from 'lucide-react';
import { DEFAULT_ENHANCE_PROMPT, PromptConfig } from '../utils/promptSettings';

interface AdminPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPromptUpdated?: (newConfig: PromptConfig) => void;
}

// This edits the server-side prompt (/api/prompt-config) directly - the only
// prompt that actually drives enhance calls. There used to also be a
// client-side/localStorage override, which meant an admin using this modal
// could believe they'd changed the studio-wide prompt while actually only
// changing what their own browser sent - a real, confusing gap. The server
// is now the sole source of truth, and every change here is version-stamped
// server-side (who/when/before/after) via admin.prompt_config_changed.
export const AdminPromptModal: React.FC<AdminPromptModalProps> = ({
  isOpen,
  onClose,
  onPromptUpdated,
}) => {
  const [enhancePrompt, setEnhancePrompt] = useState(DEFAULT_ENHANCE_PROMPT);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [resetMsg, setResetMsg] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSavedMsg(false);
      setResetMsg(false);
      setLoadError('');
      setLoading(true);
      fetch('/api/prompt-config')
        .then((res) => res.json())
        .then((data) => {
          setEnhancePrompt(data.enhancePrompt || DEFAULT_ENHANCE_PROMPT);
        })
        .catch(() => {
          setLoadError('Could not load the current studio prompt from the server. Showing the default - saving now would overwrite whatever is actually live.');
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const savePrompt = async (promptText: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/prompt-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enhancePrompt: promptText }),
      });
      const data = await res.json();
      const applied = data.enhancePrompt || promptText;
      setEnhancePrompt(applied);
      if (onPromptUpdated) {
        onPromptUpdated({ enhancePrompt: applied });
      }
      return true;
    } catch {
      setLoadError('Save failed - could not reach the server. The prompt shown here was not applied.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const ok = await savePrompt(enhancePrompt.trim() || DEFAULT_ENHANCE_PROMPT);
    if (ok) {
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    }
  };

  const handleReset = async () => {
    const ok = await savePrompt(DEFAULT_ENHANCE_PROMPT);
    if (ok) {
      setResetMsg(true);
      setTimeout(() => setResetMsg(false), 2000);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(enhancePrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const insertVariable = (variableName: string) => {
    setEnhancePrompt((prev) => prev + `\n* Product Specification: ${variableName}`);
  };

  const wordCount = enhancePrompt.trim().split(/\s+/).filter(Boolean).length;
  const charCount = enhancePrompt.length;

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white border border-stone-200 rounded-3xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] my-auto">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-stone-200 flex items-center justify-between bg-stone-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center shadow-xs">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-stone-900 text-base sm:text-lg">
                  AI Enhancement Prompt Editor
                </h3>
                <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border border-amber-300">
                  Admin Master Studio
                </span>
              </div>
              <p className="text-xs text-stone-500 font-medium">
                Customize the studio retouching instructions sent to the AI enhancement model.
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

        {/* Notifications */}
        {savedMsg && (
          <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span className="font-bold">Prompt saved! All subsequent photo enhancements will use this prompt.</span>
            </div>
          </div>
        )}

        {resetMsg && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-amber-600" />
              <span className="font-bold">Prompt reset to official RL Jewels catalogue master default.</span>
            </div>
          </div>
        )}

        {loadError && (
          <div className="bg-red-50 border-b border-red-200 text-red-800 text-xs px-4 py-2.5 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-bold">{loadError}</span>
          </div>
        )}

        {/* Body content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-red-600" />
              <span className="font-bold text-stone-800">Master Prompt Instructions</span>
              <span className="text-stone-400">({wordCount} words • {charCount} chars)</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy Prompt'}</span>
              </button>

              <button
                type="button"
                onClick={handleReset}
                disabled={loading || saving}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-amber-100 disabled:opacity-50 text-stone-700 hover:text-amber-800 text-xs font-semibold transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Default</span>
              </button>
            </div>
          </div>

          {/* Textarea */}
          <div className="relative">
            {loading && (
              <div className="absolute inset-0 z-10 bg-stone-900/60 rounded-2xl flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-stone-300 animate-spin" />
              </div>
            )}
            <textarea
              value={enhancePrompt}
              onChange={(e) => setEnhancePrompt(e.target.value)}
              rows={16}
              disabled={loading || saving}
              className="w-full bg-stone-900 text-stone-100 font-mono text-xs sm:text-[13px] leading-relaxed p-4 rounded-2xl border border-stone-700 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 resize-y shadow-inner disabled:opacity-70"
              placeholder="Enter product enhancement prompt..."
              spellCheck={false}
            />
          </div>

          {/* Quick Variable Injection Tips */}
          <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-3.5 text-xs text-amber-900 space-y-2">
            <div className="flex items-center gap-2 font-bold text-amber-950">
              <Info className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Prompt Tuning Tips:</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-800">
              The model operates on a reference-first basis. The instructions emphasize reproducing fine jewellery geometry with zero hallucination, pure #FFFFFF isolation, and 5500K metallic luster. You can edit any section above directly.
            </p>
          </div>

        </div>

        {/* Footer actions */}
        <div className="p-4 sm:p-5 border-t border-stone-200 bg-stone-50 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold text-xs uppercase tracking-wider transition-colors"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={loading || saving}
              className="min-h-[44px] flex items-center gap-2 px-6 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider shadow-md transition-all active:scale-95"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{saving ? 'Saving...' : 'Save & Apply Prompt'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};