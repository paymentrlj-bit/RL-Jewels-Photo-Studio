import React from 'react';
import { KeyRound, X, Lock, Info } from 'lucide-react';

interface AdminSecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminSecurityModal: React.FC<AdminSecurityModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

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

        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3.5 py-3 rounded-xl flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Passwords are set as environment variables on the server, not through this app - this keeps them safe
            from resetting whenever the server restarts or redeploys.
          </p>
        </div>

        <div className="space-y-3">
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-stone-400" />
              <span>Admin Password</span>
            </label>
            <p className="text-xs text-stone-600 font-mono">ADMIN_PASSWORD</p>
          </div>

          <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-stone-400" />
              <span>General Staff Password</span>
            </label>
            <p className="text-xs text-stone-600 font-mono">STAFF_PASSWORD</p>
            <p className="text-[10px] text-stone-400 mt-1">Shared by all counter staff.</p>
          </div>

          <p className="text-[11px] text-stone-500">
            To change either one, set the matching environment variable in your hosting provider's dashboard and
            redeploy. If left unset, the defaults are <span className="font-mono">admin</span> and{' '}
            <span className="font-mono">gold</span>.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 px-4 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs uppercase tracking-wider transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};
