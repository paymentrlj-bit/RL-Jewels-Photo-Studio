import React, { useState } from 'react';
import { Lock, User, KeyRound, ShieldAlert, CheckCircle2, ArrowRight } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { UserSession, AuthConfig, STAFF_MEMBERS } from '../types';

const AUTH_CONFIG_STORAGE_KEY = 'rlj_auth_config_v1';
const USER_SESSION_STORAGE_KEY = 'rlj_user_session_v1';

export function getStoredAuthConfig(): AuthConfig {
  try {
    const raw = localStorage.getItem(AUTH_CONFIG_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to load auth config:', e);
  }
  return {
    adminPassword: 'admin',
    staffPassword: 'gold',
  };
}

export function saveStoredAuthConfig(config: AuthConfig): void {
  try {
    localStorage.setItem(AUTH_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save auth config:', e);
  }
}

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

  if (!isOpen) return null;

  const handleLogin = (e: React.FormEvent) => {
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

    const authConfig = getStoredAuthConfig();
    const isAdmin = cleanUser.toLowerCase() === 'admin';

    if (isAdmin) {
      if (cleanPass === authConfig.adminPassword) {
        const session: UserSession = {
          username: 'admin',
          isAdmin: true,
          loggedInAt: new Date().toISOString(),
        };
        saveStoredUserSession(session);
        onLoginSuccess(session);
        setErrorMsg('');
      } else {
        setErrorMsg('Invalid developer/admin password.');
      }
    } else {
      // General staff user
      if (cleanPass === authConfig.staffPassword) {
        const session: UserSession = {
          username: cleanUser,
          isAdmin: false,
          loggedInAt: new Date().toISOString(),
        };
        saveStoredUserSession(session);
        onLoginSuccess(session);
        setErrorMsg('');
      } else {
        setErrorMsg('Incorrect staff password. (Default is "gold")');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-stone-200 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6 relative overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Top Gold & Red Accent Line */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-600 via-amber-400 to-red-600" />

        {/* Brand Header */}
        <div className="text-center space-y-2 pt-2">
          <div className="flex justify-center mb-3">
            <BrandLogo variant="3d-badge" size="md" />
          </div>
          <h2 className="text-2xl font-serif italic font-bold text-stone-900">
            Internal Staff Sign In
          </h2>
          <p className="text-xs text-stone-500 font-medium">
            RL Jewels Counter Photo Studio & ERP Management
          </p>
        </div>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3.5 py-2.5 rounded-xl flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-medium">{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Username Input */}
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

          {/* Password Input */}
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

          {/* Login Submit Button */}
          <button
            type="submit"
            className="w-full py-3.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm uppercase tracking-wider shadow-md shadow-red-900/15 flex items-center justify-center gap-2 transition-all active:scale-[0.99] mt-2"
          >
            <span>Access Counter Studio</span>
            <ArrowRight className="w-4 h-4" />
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
