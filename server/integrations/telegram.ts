// Sends the daily summary to a Telegram chat.
//
// The bot token is a secret. It is read from TELEGRAM_BOT_TOKEN, or, so that no
// one has to log in to the server, from a setting an admin saves in the app. It
// is never sent back to the browser - only whether one is set and its last four
// characters. The chat to post to is picked in the app from the chats the bot
// has seen (Telegram only lets a bot see chats that have messaged it or added it).
import { getSetting, setSetting } from '../settings';
import { logEvent } from '../logging';
import { buildDailySummary, renderSummaryText, AUDIT_CHECK_LABELS_SERVER } from '../reports/dailySummary';
import { istDate } from '../db/products';

const KEY_TOKEN = 'telegram_token';
const KEY_CHAT = 'telegram_chat_id';
const KEY_HOUR = 'summary_hour';
const KEY_LAST_SENT = 'summary_last_sent';
const DEFAULT_HOUR = 20;

export function getToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || getSetting(KEY_TOKEN) || '';
}
export function getChatId(): string {
  return process.env.TELEGRAM_CHAT_ID?.trim() || getSetting(KEY_CHAT) || '';
}
export function getSendHour(): number {
  const n = Number(getSetting(KEY_HOUR) ?? process.env.SUMMARY_SEND_HOUR);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_HOUR;
}

export function saveToken(token: string, by: string): void {
  setSetting(KEY_TOKEN, token.trim(), by);
}
export function saveChatId(chatId: string, by: string): void {
  setSetting(KEY_CHAT, chatId.trim(), by);
}
export function saveSendHour(hour: number, by: string): void {
  setSetting(KEY_HOUR, String(hour), by);
}

export interface TelegramStatus {
  hasToken: boolean;
  tokenHint: string;
  tokenFromEnv: boolean;
  chatId: string;
  hour: number;
  lastSent: string | null;
}

export function telegramStatus(): TelegramStatus {
  const token = getToken();
  return {
    hasToken: Boolean(token),
    tokenHint: token ? `…${token.slice(-4)}` : '',
    tokenFromEnv: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    chatId: getChatId(),
    hour: getSendHour(),
    lastSent: getSetting(KEY_LAST_SENT),
  };
}

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = getToken();
  if (!token) throw new Error('No Telegram bot token is set.');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(`Telegram said: ${json?.description ?? res.status}`);
  return json.result as T;
}

export async function botName(): Promise<string> {
  const me = await call<{ username?: string }>('getMe');
  return me.username ? `@${me.username}` : 'the bot';
}

export interface SeenChat { id: string; title: string; type: string }

/** Chats that have messaged the bot or added it (what Telegram lets a bot see). */
export async function discoverChats(): Promise<SeenChat[]> {
  const updates = await call<{ message?: { chat: TgChat }; my_chat_member?: { chat: TgChat }; channel_post?: { chat: TgChat } }[]>('getUpdates', { limit: 100 });
  const seen = new Map<string, SeenChat>();
  for (const u of updates) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (!chat) continue;
    const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'Chat';
    seen.set(String(chat.id), { id: String(chat.id), title, type: chat.type });
  }
  return [...seen.values()];
}
interface TgChat { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string }

export async function sendMessage(text: string, chatId = getChatId()): Promise<void> {
  if (!chatId) throw new Error('No Telegram chat is chosen yet.');
  // Plain text: no formatting mode to trip over a name with an underscore in it.
  await call('sendMessage', { chat_id: chatId, text: text.replace(/\*/g, '') });
}

export function summaryMessage(): string {
  return renderSummaryText(buildDailySummary(), AUDIT_CHECK_LABELS_SERVER);
}

export async function sendDailySummaryNow(): Promise<void> {
  await sendMessage(summaryMessage());
  setSetting(KEY_LAST_SENT, istDate(), 'scheduler');
  logEvent('summary.sent', { channel: 'telegram' });
}

/** India-time hour and date right now. */
function istNow(): { hour: number; date: string } {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date())) % 24;
  return { hour, date: istDate() };
}

/**
 * Checks once a minute and sends the summary once a day, at or after the chosen
 * hour (so a restart at 8:05 pm still sends it). A failing send is retried each
 * minute but gives up after five tries that day, so a bad token cannot spam logs.
 */
export function startDailySummarySender(): void {
  let failuresToday = { date: '', n: 0 };
  const timer = setInterval(() => {
    void (async () => {
      try {
        if (!getToken() || !getChatId()) return;
        const now = istNow();
        if (now.hour < getSendHour() || getSetting(KEY_LAST_SENT) === now.date) return;
        if (failuresToday.date === now.date && failuresToday.n >= 5) return;
        try {
          await sendDailySummaryNow();
        } catch (err) {
          failuresToday = { date: now.date, n: failuresToday.date === now.date ? failuresToday.n + 1 : 1 };
          logEvent('summary.send_failed', { channel: 'telegram', attempt: failuresToday.n, errorMessage: (err as Error).message.replace(getToken(), '***') });
        }
      } catch (err) {
        console.warn('[summary] check failed:', (err as Error).message);
      }
    })();
  }, 60_000);
  timer.unref();
}
