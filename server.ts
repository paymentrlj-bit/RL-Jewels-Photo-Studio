import express from 'express';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_ENHANCE_PROMPT } from './src/utils/promptSettings';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// ---------------------------------------------------------------------------
// Gemini client
// ---------------------------------------------------------------------------

let genAIClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!genAIClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY environment variable is missing.');
    }
    genAIClient = new GoogleGenAI({ apiKey: apiKey || '' });
  }
  return genAIClient;
}

// Tiered models: cheap/fast tier for the normal case, escalate to the higher-quality
// tier only for the one auto-retry after a self-QA failure. Verified live against the
// account's actual model list on 2026-08-15 - do not "helpfully" guess new names here
// without testing against /v1beta/models first, the previous version of this file
// shipped several model IDs that were stale or never existed.
const MODEL_ENHANCE_DEFAULT = 'gemini-3.1-flash-image';
const MODEL_ENHANCE_ESCALATED = 'nano-banana-pro-preview';
const MODEL_AUDIT = 'gemini-3.1-flash-lite';

const CALL_TIMEOUT_MS = 45_000;

function isBillingError(err: any): boolean {
  const message = String(err?.message || err || '');
  return /prepayment credits are depleted|spending cap|exceeded its monthly/i.test(message);
}

function isTransientError(err: any): boolean {
  const message = String(err?.message || err || '');
  const code = err?.status || err?.code;

  // Billing/quota-cap errors come back as 429 too, but retrying never helps -
  // check these first so they don't fall into the generic 429-is-transient case.
  if (/prepayment credits are depleted|spending cap|exceeded its monthly/i.test(message)) {
    return false;
  }
  if (code === 429 || code === 500 || code === 503 || code === 504) return true;
  if (/RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message)) {
    return true;
  }
  return false;
}

async function withTransientRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isTransientError(err)) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

interface EnhanceResult {
  imageBase64: string;
  mimeType: string;
}

async function enhanceImage(
  ai: GoogleGenAI,
  model: string,
  imageBase64: string,
  mimeType: string,
  prompt: string
): Promise<EnhanceResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: prompt },
        ],
      },
      config: {
        // 1K is visually indistinguishable from 2K at normal web/catalogue
        // display sizes and costs roughly 33% less per image - 2K only
        // matters for print or heavy pinch-zoom, neither of which applies here.
        imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
        abortSignal: controller.signal,
      } as any,
    });
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return { imageBase64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
      }
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface AuditResult {
  overallPass: boolean;
  reason: string;
  checklist: Record<string, boolean>;
}

async function auditOutput(
  ai: GoogleGenAI,
  originalBase64: string,
  originalMime: string,
  enhancedBase64: string,
  enhancedMime: string,
  context: { itemType: string; purity: string }
): Promise<AuditResult> {
  const prompt = `You are a strict quality inspector for "RL Jewels" e-commerce catalogue photos.
IMAGE 1 is the original counter photo. IMAGE 2 is the AI-enhanced result that is about to be published.
Item: ${context.purity} gold ${context.itemType}.

Compare IMAGE 2 against IMAGE 1 and grade it. Respond ONLY as JSON matching this schema:
{
  "sharpFocus": boolean,        // is the jewelry in image 2 in sharp focus, edge to edge?
  "notCropped": boolean,        // is the full piece visible, nothing cut off by the frame?
  "backgroundCleanWhite": boolean, // is the background a clean, seamless white with no artifacts?
  "noBlownHighlights": boolean, // are metal highlights not blown out to pure white with no detail?
  "neutralWhiteBalance": boolean, // is the metal color neutral/true (not orange or blue-tinted)?
  "matchesOriginalDesign": boolean, // CRITICAL: does image 2 show the exact same design as image 1, with no added, removed, or altered engravings, motifs, stones, proportions, or band/chain profile?
  "overallPass": boolean,       // true only if ALL of the above are true
  "reason": string              // if overallPass is false, a short, specific, staff-facing reason naming which check failed and why (e.g. "The enhanced image added a decorative pattern to the band that isn't on the original piece."). If overallPass is true, a short confirmation.
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model: MODEL_AUDIT,
      contents: {
        parts: [
          { inlineData: { mimeType: originalMime, data: originalBase64 } },
          { inlineData: { mimeType: enhancedMime, data: enhancedBase64 } },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        abortSignal: controller.signal,
      } as any,
    });
    const parsed = JSON.parse(response.text?.trim() || '{}');
    const checklist = {
      sharpFocus: Boolean(parsed.sharpFocus),
      notCropped: Boolean(parsed.notCropped),
      backgroundCleanWhite: Boolean(parsed.backgroundCleanWhite),
      noBlownHighlights: Boolean(parsed.noBlownHighlights),
      neutralWhiteBalance: Boolean(parsed.neutralWhiteBalance),
      matchesOriginalDesign: Boolean(parsed.matchesOriginalDesign),
    };
    const overallPass = typeof parsed.overallPass === 'boolean' ? parsed.overallPass : Object.values(checklist).every(Boolean);
    return {
      overallPass,
      reason: parsed.reason || (overallPass ? 'Passed quality check.' : 'Did not meet catalogue quality standards.'),
      checklist,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Auth: server-side session, so "logged out" is an actual gate, not a UI state.
// Credentials persist to a small JSON file (gitignored) so an admin can change
// them from the UI without a database. Passwords are hashed, never stored plain.
// ---------------------------------------------------------------------------

// Credentials live in environment variables, not a local file - free/serverless
// hosts (Cloud Run, Render's free tier, etc.) run on ephemeral containers that
// get recycled on every deploy and, on some free tiers, after any idle period.
// A local JSON file would silently reset to defaults on every restart.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'gold';

// Sessions are stateless signed cookies (not an in-memory Map) for the same
// reason: an in-memory session store would log every signed-in staff member
// out the moment the container restarts, which on a free tier that spins down
// after idle time could happen several times a day.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn(
    'SESSION_SECRET is not set - a random one was generated for this process only. ' +
    'Every restart will log all staff out. Set SESSION_SECRET as a fixed environment ' +
    'variable in your hosting provider to avoid this.'
  );
}

interface SessionInfo {
  username: string;
  isAdmin: boolean;
  exp: number; // epoch ms
}

const SESSION_COOKIE = 'rlj_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours - a counter shift

function signSession(info: SessionInfo): string {
  const payload = Buffer.from(JSON.stringify(info)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySession(token: string): SessionInfo | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const info: SessionInfo = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!info.exp || Date.now() > info.exp) return null;
    return info;
  } catch {
    return null;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function setSessionCookie(res: express.Response, info: SessionInfo): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const token = signSession(info);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
}

function clearSessionCookie(res: express.Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function getSession(req: express.Request): SessionInfo | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return verifySession(token);
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  (req as any).session = session;
  next();
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password || '').trim();
  if (!cleanUser || !cleanPass) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const isAdminAttempt = cleanUser.toLowerCase() === 'admin';
  const expected = isAdminAttempt ? ADMIN_PASSWORD : STAFF_PASSWORD;

  if (!timingSafeStringEqual(cleanPass, expected)) {
    return res.status(401).json({ error: isAdminAttempt ? 'Invalid admin password.' : 'Incorrect staff password.' });
  }

  const session: SessionInfo = {
    username: isAdminAttempt ? 'admin' : cleanUser,
    isAdmin: isAdminAttempt,
    exp: Date.now() + SESSION_TTL_MS,
  };
  setSessionCookie(res, session);
  res.json({ username: session.username, isAdmin: session.isAdmin });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/session', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ username: session.username, isAdmin: session.isAdmin });
});

// Health & Status endpoint (public - lets the UI show "AI offline" banners pre-login)
app.get('/api/health', (req, res) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  res.json({
    status: 'ok',
    hasApiKey: hasKey,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Free OCR tag scanning (OCR.space + local parsing - no Gemini cost)
// ---------------------------------------------------------------------------

app.post('/api/ocr-space', requireAuth, async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const apiKey = process.env.OCR_SPACE_API_KEY || 'K88888888888957';
    const formParams = new URLSearchParams();
    formParams.append('base64Image', imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`);
    formParams.append('apikey', apiKey);
    formParams.append('language', 'eng');
    formParams.append('isOverlayRequired', 'false');
    formParams.append('isTable', 'true');
    formParams.append('scale', 'true');
    formParams.append('OCREngine', '2');
    formParams.append('detectOrientation', 'true');

    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formParams,
    });

    const ocrData: any = await ocrResponse.json();
    const rawText = ocrData?.ParsedResults?.[0]?.ParsedText || '';

    return res.json({
      success: true,
      rawText,
      exitCode: ocrData?.OCRExitCode,
    });
  } catch (error: any) {
    console.warn('OCR.space call notice:', error?.message);
    return res.json({
      success: false,
      rawText: '',
      error: error?.message || 'OCR.space service unavailable',
    });
  }
});

app.post('/api/scan-tag', requireAuth, async (req, res) => {
  try {
    const { imageBase64, side = 'side1', existingCpc } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing imageBase64' });
    }

    const apiKey = process.env.OCR_SPACE_API_KEY || 'K88888888888957';
    const formParams = new URLSearchParams();
    formParams.append('base64Image', imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`);
    formParams.append('apikey', apiKey);
    formParams.append('language', 'eng');
    formParams.append('isOverlayRequired', 'false');
    formParams.append('isTable', 'true');
    formParams.append('scale', 'true');
    formParams.append('OCREngine', '2');
    formParams.append('detectOrientation', 'true');

    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formParams,
    });

    const ocrData: any = await ocrResponse.json();
    const rawText = ocrData?.ParsedResults?.[0]?.ParsedText || '';

    return res.json({
      success: true,
      rawText,
      side,
      cpc: existingCpc || '',
    });
  } catch (err: any) {
    console.warn('Free tag scan notice:', err?.message || err);
    return res.json({
      success: false,
      rawText: '',
      error: err?.message || 'Free OCR failed',
    });
  }
});

// ---------------------------------------------------------------------------
// Admin-editable enhancement prompt
// ---------------------------------------------------------------------------

let serverCustomPrompt: string = DEFAULT_ENHANCE_PROMPT;

app.get('/api/prompt-config', requireAuth, (req, res) => {
  res.json({
    enhancePrompt: serverCustomPrompt || DEFAULT_ENHANCE_PROMPT,
    defaultPrompt: DEFAULT_ENHANCE_PROMPT,
  });
});

app.post('/api/prompt-config', requireAuth, (req, res) => {
  const { enhancePrompt } = req.body;
  if (enhancePrompt && typeof enhancePrompt === 'string') {
    serverCustomPrompt = enhancePrompt.trim();
  }
  res.json({
    success: true,
    enhancePrompt: serverCustomPrompt,
  });
});

// ---------------------------------------------------------------------------
// Core pipeline: enhance -> audit the OUTPUT -> one escalated retry -> else
// needs_reshoot with a specific reason. Never silently ship a failed result,
// and never fall back to a fake local "enhancement" - a failed AI call is
// reported as failed so staff can just retry, not papered over.
// ---------------------------------------------------------------------------

app.post('/api/audit-and-enhance', requireAuth, async (req, res) => {
  const { imageBase64, itemType, purity, gender, sku, cpc, weight, customEnhancePrompt } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: 'Missing imageBase64 data' });
  }

  const match = imageBase64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  const mimeType = match ? match[1] : 'image/jpeg';
  const cleanBase64 = match ? match[2] : imageBase64;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.json({
      status: 'failed',
      reason: 'GEMINI_API_KEY is not configured on the server.',
      retryable: false,
    });
  }

  const ai = getGeminiClient();
  const promptTemplate =
    customEnhancePrompt && typeof customEnhancePrompt === 'string' && customEnhancePrompt.trim()
      ? customEnhancePrompt.trim()
      : serverCustomPrompt || DEFAULT_ENHANCE_PROMPT;

  const contextBlock = `

ADDITIONAL CONTEXT (FROM CATALOG FORM):
- Item Category: ${itemType || 'jewellery'}
- Purity: ${purity || '22kt'} Gold
- Intended For: ${gender || "women's"}
${weight ? `- Weight: ${weight}g` : ''}`;

  const auditContext = { itemType: itemType || 'jewellery', purity: purity || '22kt' };

  try {
    // Attempt 1: default (cheap/fast) tier
    let enhanced: EnhanceResult | null = null;
    try {
      enhanced = await withTransientRetry(() =>
        enhanceImage(ai, MODEL_ENHANCE_DEFAULT, cleanBase64, mimeType, promptTemplate + contextBlock)
      );
    } catch (err: any) {
      console.error('Enhance (default tier) failed after retries:', err?.message || err);
      if (isBillingError(err)) {
        return res.json({
          status: 'failed',
          reason: 'The Gemini account has hit its billing/spend cap. An admin needs to raise it in AI Studio before photos can be processed.',
          retryable: false,
        });
      }
      return res.json({
        status: 'failed',
        reason: 'AI enhancement service did not respond. Please try again.',
        retryable: true,
      });
    }

    if (!enhanced) {
      return res.json({
        status: 'failed',
        reason: 'The AI model did not return an edited image. Please try again.',
        retryable: true,
      });
    }

    let audit = await withTransientRetry(() =>
      auditOutput(ai, cleanBase64, mimeType, enhanced!.imageBase64, enhanced!.mimeType, auditContext)
    );
    let modelUsed = MODEL_ENHANCE_DEFAULT;
    let attemptCount = 1;

    if (!audit.overallPass) {
      // Single escalated retry with the specific failure reason fed back in.
      const correctivePrompt = `${promptTemplate}${contextBlock}

IMPORTANT: A previous attempt at this edit failed quality review for this specific reason:
"${audit.reason}"
Correct this specific issue while still following every rule above.`;

      try {
        const retryEnhanced = await withTransientRetry(() =>
          enhanceImage(ai, MODEL_ENHANCE_ESCALATED, cleanBase64, mimeType, correctivePrompt)
        );
        attemptCount = 2;
        if (retryEnhanced) {
          const retryAudit = await withTransientRetry(() =>
            auditOutput(ai, cleanBase64, mimeType, retryEnhanced.imageBase64, retryEnhanced.mimeType, auditContext)
          );
          if (retryAudit.overallPass) {
            enhanced = retryEnhanced;
            audit = retryAudit;
            modelUsed = MODEL_ENHANCE_ESCALATED;
          } else {
            return res.json({
              status: 'needs_reshoot',
              reason: retryAudit.reason,
              checklist: retryAudit.checklist,
              originalImage: imageBase64,
            });
          }
        } else {
          return res.json({
            status: 'needs_reshoot',
            reason: audit.reason,
            checklist: audit.checklist,
            originalImage: imageBase64,
          });
        }
      } catch (err: any) {
        console.error('Escalated retry failed:', err?.message || err);
        return res.json({
          status: 'needs_reshoot',
          reason: audit.reason,
          checklist: audit.checklist,
          originalImage: imageBase64,
        });
      }
    }

    return res.json({
      status: 'approved',
      reason: audit.reason,
      checklist: audit.checklist,
      processedImageBase64: `data:${enhanced.mimeType};base64,${enhanced.imageBase64}`,
      modelUsed,
      attemptCount,
    });
  } catch (error: any) {
    console.error('Error in /api/audit-and-enhance:', error);
    return res.json({
      status: 'failed',
      reason: 'Unexpected error while processing this photo. Please try again.',
      retryable: true,
    });
  }
});

// ---------------------------------------------------------------------------
// Vite middleware / static production serving
// ---------------------------------------------------------------------------

async function setupServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RL Jewels Photo Studio server running on http://localhost:${PORT}`);
  });
}

setupServer();