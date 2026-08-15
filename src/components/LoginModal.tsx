import React, { useState } from 'react';
import { Lock, User, ShieldAlert, ArrowRight, Loader2 } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { UserSession } from '../types';

const USER_SESSION_STORAGE_KEY = 'rlj_user_session_v1';

// The session cookie set by the server is the actual access gate (httpOnly,
// can't be read or forged from the browser). This local copy is only a display
// convenience so the UI can show "signed in as X" without an extra round trip -
// it is never trusted for access control.
export function getStoredUserSession(): UserSession | null {
  try {
    const raw = localStorage.getItem(USER_SESSION_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to load user session:', e);
  }
  return null;
}

export function saveStoredUserSession(session: UserSession | null): void {
  try {
    if (session) {
      localStorage.setItem(USER_SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(USER_SESSION_STORAGE_KEY);
    }
  } catch (e) {
    console.error('Failed to save user session:', e);
  }
}

interface LoginModalProps {
  isOpen: boolean;
  onLoginSuccess: (session: UserSession) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = username.trim();
    const cleanPass = password.trim();

    if (!cleanUser) {
      setErrorMsg('Please enter your name or staff ID.');
      return;
    }
    if (!cleanPass) {
      setErrorMsg('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password: cleanPass }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Sign in failed.');
        return;
      }
      const session: UserSession = {
        username: data.username,
        isAdmin: data.isAdmin,
        loggedInAt: new Date().toISOString(),
      };
      saveStoredUserSession(session);
      onLoginSuccess(session);
    } catch (err) {
      setErrorMsg('Could not reach the server. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-stone-200 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6 relative overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-600 via-amber-400 to-red-600" />

        <div className="text-center space-y-2 pt-2">
          <div className="flex justify-center mb-3">
            <BrandLogo variant="3d-badge" size="md" />
          </div>
          <h2 className="text-2xl font-serif italic font-bold text-stone-900">
            Internal Staff Sign In
          </h2>
          <p className="text-xs text-stone-500 font-medium">
            RL Jewels Counter Photo Studio
          </p>
        </div>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3.5 py-2.5 rounded-xl flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-medium">{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1.5 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-stone-400" />
              <span>Auditor / User Name</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setErrorMsg('');
              }}
              placeholder="e.g. admin or Staff Name"
              className="w-full bg-stone-50 border border-stone-200 focus:border-red-600 focus:bg-white rounded-xl px-4 py-3 text-stone-900 text-sm focus:outline-none transition-all font-medium"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1.5 flex items-center">
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-stone-400" />
                <span>Password</span>
              </span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrorMsg('');
              }}
              placeholder="Enter password"
              className="w-full bg-stone-50 border border-stone-200 focus:border-red-600 focus:bg-white rounded-xl px-4 py-3 text-stone-900 text-sm focus:outline-none transition-all font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold text-sm uppercase tracking-wider shadow-md shadow-red-900/15 flex items-center justify-center gap-2 transition-all active:scale-[0.99] mt-2"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            <span>{isSubmitting ? 'Signing in…' : 'Access Counter Studio'}</span>
          </button>
        </form>

        <div className="border-t border-stone-100 pt-3 text-center">
          <p className="text-[11px] text-stone-400 font-medium">
            Internal RL Jewels Authorized Personnel Only
          </p>
        </div>
      </div>
    </div>
  );
};
