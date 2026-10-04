// Admin: send the daily summary to a Telegram chat automatically.
// Three steps: save the bot's token, pick the chat, choose the hour.
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type TelegramStatus } from '../api';

export const TelegramSetup: React.FC = () => {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState('');
  const [chats, setChats] = useState<{ id: string; title: string; type: string }[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.telegram().then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ ok: true, text });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'That did not work.' });
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  return (
    <div className="mt-5 border-t border-stone-200 pt-4">
      <h4 className="text-sm font-semibold text-stone-900">Send it automatically on Telegram</h4>
      <p className="mt-1 text-xs text-stone-500">
        {status.chatId && status.hasToken
          ? `On. Goes out every day at ${status.hour > 12 ? status.hour - 12 : status.hour || 12} ${status.hour >= 12 ? 'pm' : 'am'}${status.lastSent ? `. Last sent ${status.lastSent}.` : '.'}`
          : 'Off until a bot token and a chat are set below.'}
      </p>

      <div className="mt-3 space-y-3 text-sm">
        <div>
          <p className="font-medium text-stone-700">1. Bot token {status.hasToken && <span className="font-normal text-emerald-700">saved ({status.tokenHint})</span>}</p>
          {!status.tokenFromEnv && (
            <div className="mt-1 flex flex-wrap gap-2">
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={status.hasToken ? 'Paste a new token to replace it' : 'Paste the token from BotFather'}
                aria-label="Telegram bot token"
                className="min-h-[44px] min-w-[220px] flex-1 rounded-lg border border-stone-300 px-3 py-2"
              />
              <button
                type="button"
                disabled={busy || !token.trim()}
                onClick={() => run(async () => {
                  const r = await api.saveTelegram({ token });
                  setToken('');
                  await load();
                  return `Saved. Connected to ${r.botName ?? 'your bot'}.`;
                })}
                className="min-h-[44px] rounded-lg bg-stone-900 px-4 py-2 text-white hover:bg-stone-800 disabled:bg-stone-300"
              >
                Save token
              </button>
            </div>
          )}
          {status.tokenFromEnv && <p className="mt-1 text-xs text-stone-500">Set on the server (TELEGRAM_BOT_TOKEN).</p>}
        </div>

        <div>
          <p className="font-medium text-stone-700">2. Chat {status.chatId && <span className="font-normal text-emerald-700">chosen ({status.chatId})</span>}</p>
          <p className="text-xs text-stone-500">
            Add the bot to your managers&apos; group (or send it /start yourself), post one message there, then tap Find chats.
          </p>
          <button
            type="button"
            disabled={busy || !status.hasToken}
            onClick={() => run(async () => {
              const r = await api.telegramChats();
              setChats(r.chats);
              if (r.chats.length === 0) return 'No chats yet. Add the bot to the group, post a message, and try again.';
            })}
            className="mt-1 min-h-[44px] rounded-lg border border-stone-300 px-4 py-2 text-stone-700 hover:bg-stone-50 disabled:opacity-60"
          >
            Find chats
          </button>
          {chats && chats.length > 0 && (
            <ul className="mt-2 space-y-1">
              {chats.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2">
                  <span>{c.title} <span className="text-xs text-stone-400">({c.type})</span></span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(async () => {
                      await api.saveTelegram({ chatId: c.id });
                      await load();
                      return `Summaries will go to ${c.title}.`;
                    })}
                    className="min-h-[44px] rounded-lg bg-emerald-600 px-3 text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    Use this chat
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 font-medium text-stone-700">
            3. Send at
            <select
              value={status.hour}
              onChange={(e) => run(async () => { await api.saveTelegram({ hour: Number(e.target.value) }); await load(); })}
              className="rounded-lg border border-stone-300 px-2 py-2 font-normal"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{`${h % 12 || 12}:00 ${h >= 12 ? 'pm' : 'am'}`}</option>
              ))}
            </select>
            <span className="font-normal text-stone-500">India time</span>
          </label>
          <button
            type="button"
            disabled={busy || !status.hasToken || !status.chatId}
            onClick={() => run(async () => { await api.telegramTest(); return 'Test sent - check Telegram.'; })}
            className="min-h-[44px] rounded-lg border border-stone-300 px-4 py-2 text-stone-700 hover:bg-stone-50 disabled:opacity-60"
          >
            Send a test now
          </button>
        </div>

        {message && (
          <p role="status" className={`rounded-lg px-3 py-2 text-xs ${message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{message.text}</p>
        )}
      </div>
    </div>
  );
};
