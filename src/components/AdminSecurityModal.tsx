import React, { useState } from 'react';
import { KeyRound, ShieldCheck, X, Check, Lock } from 'lucide-react';
import { AuthConfig } from '../types';
import { getStoredAuthConfig, saveStoredAuthConfig } from './LoginModal';

interface AdminSecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminSecurityModal: React.FC<AdminSecurityModalProps> = ({ isOpen, onClose }) => {
  const currentConfig = getStoredAuthConfig();
  const [adminPassword, setAdminPassword] = useState(currentConfig.adminPassword);
  const [staffPassword, setStaffPassword] = useState(currentConfig.staffPassword);
  const [savedMsg, setSavedMsg] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: AuthConfig = {
      adminPassword: adminPassword.trim() || 'admin',
      staffPassword: staffPassword.trim() || 'gold',
    };
    saveStoredAuthConfig(updated);
    setSavedMsg(true);
    setTimeout(() => {
      setSavedMsg(false);
      onClose();
    }, 1200);
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

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1">
              Developer / Admin Password
            </label>
            <input
              type="text"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 focus:border-red-600 rounded-xl px-3.5 py-2.5 text-stone-900 text-sm font-mono focus:outline-none"
              placeholder="admin"
            />
            <p className="text-[10px] text-stone-400 mt-1">Default is <code className="text-red-600 font-bold">admin</code></p>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1">
              General Staff Password
            </label>
            <input
              type="text"
              value={staffPassword}
              onChange={(e) => setStaffPassword(e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 focus:border-red-600 rounded-xl px-3.5 py-2.5 text-stone-900 text-sm font-mono focus:outline-none"
              placeholder="gold"
            />
            <p className="text-[10px] text-stone-400 mt-1">Default is <code className="text-amber-700 font-bold">gold</code> for all counter staff</p>
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
              className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider shadow-xs transition-colors"
            >
              Save Passwords
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
