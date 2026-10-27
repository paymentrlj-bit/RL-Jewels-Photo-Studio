import React, { useState } from 'react';
import { api, ApiError } from '../api';
import { PasswordInput } from './PasswordInput';

const field = 'rounded-lg border border-stone-300 px-3 py-2 text-sm';

export const ChangePasswordDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.changeMyPassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <form onSubmit={save} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5">
        <h2 className="font-semibold text-stone-900">Change my password</h2>
        {done ? (
          <p className="text-sm text-green-700">Done. Use the new password next time you sign in.</p>
        ) : (
          <>
            <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" ariaLabel="Current password" placeholder="Current password" className={field} />
            <PasswordInput value={next} onChange={setNext} autoComplete="new-password" ariaLabel="New password" placeholder="New password (10+ characters)" className={field} />
            {error && <p className="text-sm text-red-700">{error}</p>}
            <p className="text-xs text-stone-500">Forgot your password? Ask an admin to reset it.</p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg px-4 text-sm text-stone-600 hover:bg-stone-100">{done ? 'Close' : 'Cancel'}</button>
          {!done && (
            <button type="submit" disabled={busy || !current || next.trim().length < 10} className="min-h-[44px] rounded-lg bg-stone-900 px-4 text-sm text-white disabled:bg-stone-300">
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
