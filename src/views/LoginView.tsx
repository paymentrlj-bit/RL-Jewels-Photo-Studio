import React, { useCallback, useState } from 'react';
import { LogIn, AlertTriangle, Loader2 } from 'lucide-react';
import { api, ApiError } from '../api';
import type { SessionUser } from '../types';
import { BrandLogo } from '../components/BrandLogo';

interface LoginViewProps {
  onSignedIn: (user: SessionUser) => void;
  aiConfigured: boolean;
}

export const LoginView: React.FC<LoginViewProps> = ({ onSignedIn, aiConfigured }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(username, password));
    } catch (err) {
      // The server deliberately does not distinguish a wrong username from a
      // wrong password, and the lockout message comes through as-is.
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }, [username, password, onSignedIn]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><BrandLogo /></div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
          <h1 className="text-lg font-semibold text-stone-900">Sign in</h1>

          {!aiConfigured && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
              This server has no Gemini API key set, so photos will queue but not process.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}

          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium text-stone-700">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-stone-700">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <button
            type="submit"
            disabled={busy || !username || !password}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:bg-stone-300"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-stone-500">
          Each staff member signs in with their own account. Ask an admin if you do not have one yet.
        </p>
      </div>
    </div>
  );
};
