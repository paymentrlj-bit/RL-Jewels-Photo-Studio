import React, { useState } from 'react';
import { KeyRound, X, Check, Lock, Loader2 } from 'lucide-react';

interface AdminSecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminSecurityModal: React.FC<AdminSecurityModalProps> = ({ isOpen, onClose }) => {
  const [adminPassword, setAdminPassword] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPassword.trim() && !staffPassword.trim()) {
      setErrorMsg('Enter at least one new password to update.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: adminPassword.trim() || undefined,
          staffPassword: staffPassword.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to update passwords.');
        return;
      }
      setSavedMsg(true);
      setAdminPassword('');
      setStaffPassword('');
      setTimeout(() => {
        setSavedMsg(false);
        onClose();
      }, 1200);
    } catch {
      setErrorMsg('Could not reach the server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-stone-200 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 relative">
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-sm">Security & Password Settings</h3>
              <p className="text-[11px] text-stone-500">Admin Control Panel</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {savedMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs px-3 py-2 rounded-xl flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span className="font-bold">Passwords updated successfully!</span>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-xl">
            <span className="font-bold">{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-stone-400" />
              <span>New Developer / Admin Password</span>
            </label>
            <input
              type="text"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 focus:border-red-600 rounded-xl px-3.5 py-2.5 text-stone-900 text-sm font-mono focus:outline-none"
              placeholder="Leave blank to keep unchanged"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-stone-400" />
              <span>New General Staff Password</span>
            </label>
            <input
              type="text"
              value={staffPassword}
              onChange={(e) => setStaffPassword(e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 focus:border-red-600 rounded-xl px-3.5 py-2.5 text-stone-900 text-sm font-mono focus:outline-none"
              placeholder="Leave blank to keep unchanged"
            />
            <p className="text-[10px] text-stone-400 mt-1">Shared by all counter staff.</p>
          </div>

          <div className="pt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs uppercase tracking-wider transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold text-xs uppercase tracking-wider shadow-xs transition-colors flex items-center justify-center gap-1.5"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Save Passwords</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
