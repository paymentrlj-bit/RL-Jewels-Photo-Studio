import React, { useState } from 'react';
import { User, LogOut, Shield, KeyRound, WifiOff, Sliders, Sparkles } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { UserSession } from '../types';
import { AdminSecurityModal } from './AdminSecurityModal';
import { AdminPromptModal } from './AdminPromptModal';

interface HeaderProps {
  currentUser: UserSession | null;
  onLogout: () => void;
  hasApiKey: boolean;
  isOnline?: boolean;
  onPromptUpdated?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  onLogout,
  hasApiKey,
  isOnline = true,
  onPromptUpdated,
}) => {
  const [showAdminSecurity, setShowAdminSecurity] = useState(false);
  const [showAdminPrompts, setShowAdminPrompts] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const displayName = currentUser?.username || 'Counter Staff';
  const isAdmin = currentUser?.isAdmin || false;

  return (
    <header className="bg-white text-stone-900 border-b border-stone-200 sticky top-0 z-30 shadow-xs">
      <div className="h-1 bg-gradient-to-r from-red-600 via-amber-400 to-red-600 w-full" />

      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2.5 sm:space-x-3 shrink-0">
          <BrandLogo variant="3d-badge" size="md" />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-black text-lg sm:text-xl tracking-tight text-red-600">
                RL JEWELS
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-bold border border-red-200 uppercase tracking-wider">
                Studio
              </span>
            </div>
            <p className="text-[11px] text-stone-500 font-medium hidden sm:block">
              Internal Photo Management
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 text-xs">
          {!isOnline && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-bold shadow-xs animate-pulse"
              title="Offline: reconnect to process photos"
            >
              <WifiOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span className="hidden md:inline">Offline</span>
            </div>
          )}

          {!hasApiKey && (
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-red-50 border border-red-300 text-red-800 text-[11px] font-bold shadow-xs"
              title="Server has no GEMINI_API_KEY configured"
            >
              <span>Studio Offline</span>
            </div>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="min-h-[44px] flex items-center gap-2 bg-stone-50 hover:bg-stone-100 px-3 py-2 rounded-xl border border-stone-200 transition-colors"
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${
                isAdmin
                  ? 'bg-red-600 text-white'
                  : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}>
                {isAdmin ? <Shield className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>
              <div className="text-left hidden xs:block sm:block">
                <span className="text-[10px] text-stone-400 block leading-none font-semibold">
                  {isAdmin ? 'Dev/Admin' : 'Auditor'}
                </span>
                <span className="text-stone-900 font-bold text-xs truncate max-w-[100px] block mt-0.5">
                  {displayName}
                </span>
              </div>
            </button>

            {showUserMenu && (
              <div
                className="absolute right-0 mt-2 w-52 bg-white border border-stone-200 rounded-2xl shadow-xl p-2 z-50 text-xs space-y-1"
                onClick={() => setShowUserMenu(false)}
              >
                <div className="px-3 py-2.5 border-b border-stone-100">
                  <p className="text-[10px] text-stone-400 uppercase font-bold tracking-wider">Signed in as</p>
                  <p className="font-bold text-stone-900 truncate text-sm">{displayName}</p>
                </div>

                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowUserMenu(false);
                        setShowAdminPrompts(true);
                      }}
                      className="w-full min-h-[44px] text-left px-3 py-2.5 rounded-xl hover:bg-stone-100 text-stone-700 font-semibold flex items-center gap-2"
                    >
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      <span>Edit AI Prompt</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowUserMenu(false);
                        setShowAdminSecurity(true);
                      }}
                      className="w-full min-h-[44px] text-left px-3 py-2.5 rounded-xl hover:bg-stone-100 text-stone-700 font-semibold flex items-center gap-2"
                    >
                      <KeyRound className="w-4 h-4 text-red-600" />
                      <span>Change Passwords</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={onLogout}
                  className="w-full min-h-[44px] text-left px-3 py-2.5 rounded-xl hover:bg-red-50 text-red-600 font-bold flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Switch User / Log Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <AdminSecurityModal
        isOpen={showAdminSecurity}
        onClose={() => setShowAdminSecurity(false)}
      />

      <AdminPromptModal
        isOpen={showAdminPrompts}
        onClose={() => setShowAdminPrompts(false)}
        onPromptUpdated={onPromptUpdated}
      />
    </header>
  );
};