// CPC master lookup and OCR tag scanning.
//
// Ported from v1 with one substantive change, noted at OCR_API_KEY below.

import express from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth/session';
import { logEvent, actorFrom } from '../logging';
import { config } from '../config';
import { debugDetail } from '../ai/client';
import {
  lookupCpc,
  addLearnedCpc,
  correctSingleRowProduct,
  deriveProductIdFromCpc,
  normalizeGoldPurity,
  guessGenderFromStyleName,
  getCpcMasterStats,
  type CpcMasterRecord,
} from '../integrations/cpcMaster';
import { findPreviousShoots } from '../db/products';

export const catalogRouter = express.Router();
catalogRouter.use(requireAuth);

catalogRouter.get('/cpc-lookup', (req: AuthenticatedRequest, res) => {
  const cpc = String(req.query.cpc || '').trim();
  if (!cpc) {
    res.status(400).json({ error: 'cpc query parameter is required.' });
    return;
  }

  const result = lookupCpc(cpc);
  logEvent('cpc.lookup', {
    cpc,
    matchType: result.matchType,
    groupName: result.record?.groupName || null,
  }, actorFrom(req.user));

  res.json({
    ...result,
    // Pre-normalized onto this app's own purity/gender types so the client
    // doesn't duplicate the "22 Ct" -> "22kt" parsing - null when the record
    // isn't gold, or gender can't be guessed.
    normalizedPurity: result.record ? normalizeGoldPurity(result.record.purity) : null,
    genderGuess: result.record ? guessGenderFromStyleName(result.record.styleName) : null,
    // New in v2: warn the staff member before they shoot something the store
    // has already photographed. Over a 3,247-product run this is the check
    // that stops duplicated work, and v1 had no way to perform it.
    previousShoots: result.productId ? findPreviousShoots(result.productId) : [],
  });
});

// Shared body parsing for /learn and /correct - both take the same shape, the
// only difference is which cpcMaster function they call with it.
function parseCpcRecordBody(body: Record<string, unknown>): { cpcNumber: string; record: CpcMasterRecord } | { error: string } {
  const { cpcNumber, styleName, sizeName, designName, groupName, purity } = body || {};
  if (!cpcNumber || typeof cpcNumber !== 'string' || !cpcNumber.trim()) {
    return { error: 'cpcNumber is required.' };
  }
  if (!groupName || typeof groupName !== 'string' || !groupName.trim()) {
    return { error: 'groupName is required.' };
  }
  const productId = deriveProductIdFromCpc(cpcNumber);
  if (!productId) {
    return { error: 'cpcNumber does not look like a valid CPC (expected <ProductId>L<LotNo>).' };
  }
  return {
    cpcNumber: cpcNumber.trim(),
    record: {
      productId,
      styleName: typeof styleName === 'string' ? styleName.trim() : '',
      sizeName: typeof sizeName === 'string' ? sizeName.trim() : '',
      designName: typeof designName === 'string' ? designName.trim() : '',
      groupName: groupName.trim(),
      purity: typeof purity === 'string' ? purity.trim() : '',
      sellByPiece: '0',
      lotCount: '1',
    },
  };
}

catalogRouter.post('/cpc-lookup/learn', (req: AuthenticatedRequest, res) => {
  const parsed = parseCpcRecordBody(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  addLearnedCpc(parsed.record);
  logEvent('cpc.learned', { cpc: parsed.cpcNumber, ...parsed.record, stats: getCpcMasterStats() }, actorFrom(req.user));
  res.json({ success: true });
});

catalogRouter.post('/cpc-lookup/correct', async (req: AuthenticatedRequest, res) => {
  const parsed = parseCpcRecordBody(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    await correctSingleRowProduct(parsed.record);
    logEvent('cpc.corrected', { cpc: parsed.cpcNumber, ...parsed.record, stats: getCpcMasterStats() }, actorFrom(req.user));
    res.json({ success: true });
  } catch (err) {
    console.error('CPC correction failed:', (err as Error)?.message || err);
    logEvent('cpc.corrected', { cpc: parsed.cpcNumber, ...parsed.record, success: false, errorMessage: debugDetail(err) }, actorFrom(req.user));
    res.status(502).json({ error: (err as Error)?.message || 'Failed to save the correction.', debugDetail: debugDetail(err) });
  }
});

catalogRouter.get('/cpc-stats', (_req, res) => {
  res.json(getCpcMasterStats());
});

// ---------------------------------------------------------------------------
// OCR tag scanning (OCR.space)
//
// CHANGED FROM v1: v1 fell back to a hardcoded key, 'K88888888888957', when
// OCR_SPACE_API_KEY was unset. That is not a real OCR.space key - calls made
// with it fail, and because the endpoint swallowed errors into
// {success:false}, the failure surfaced to staff as "OCR just doesn't work
// very well" rather than "nobody set the key." Now an unset key is reported
// as exactly that, once, so it can be fixed.
// ---------------------------------------------------------------------------

async function runOcr(imageBase64: string): Promise<{ rawText: string; exitCode: number | undefined }> {
  const formParams = new URLSearchParams();
  formParams.append('base64Image', imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`);
  formParams.append('apikey', config.ocrSpaceApiKey!);
  formParams.append('language', 'eng');
  formParams.append('isOverlayRequired', 'false');
  formParams.append('isTable', 'true');
  formParams.append('scale', 'true');
  formParams.append('OCREngine', '2');
  formParams.append('detectOrientation', 'true');

  const response = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: formParams });
  const data = (await response.json()) as { ParsedResults?: { ParsedText?: string }[]; OCRExitCode?: number };

  return {
    rawText: data?.ParsedResults?.[0]?.ParsedText || '',
    exitCode: data?.OCRExitCode,
  };
}

function ocrUnavailable(res: express.Response): void {
  res.json({
    success: false,
    rawText: '',
    error:
      'OCR is not configured on this server. Set OCR_SPACE_API_KEY (free tier at ocr.space) to enable tag text scanning. ' +
      'Barcode and QR scanning work without it.',
    notConfigured: true,
  });
}

catalogRouter.post('/ocr-space', async (req: AuthenticatedRequest, res) => {
  const startedAt = Date.now();
  const imageBase64 = req.body?.imageBase64;
  if (!imageBase64) {
    res.status(400).json({ error: 'No image provided' });
    return;
  }
  if (!config.ocrSpaceApiKey) {
    ocrUnavailable(res);
    return;
  }

  try {
    const { rawText, exitCode } = await runOcr(imageBase64);
    logEvent('ocr.call', {
      endpoint: 'ocr-space',
      success: true,
      latencyMs: Date.now() - startedAt,
      exitCode,
      rawTextLength: rawText.length,
    }, actorFrom(req.user));
    res.json({ success: true, rawText, exitCode });
  } catch (error) {
    console.warn('OCR.space call notice:', (error as Error)?.message);
    logEvent('ocr.call', {
      endpoint: 'ocr-space',
      success: false,
      latencyMs: Date.now() - startedAt,
      errorMessage: debugDetail(error),
    }, actorFrom(req.user));
    res.json({ success: false, rawText: '', error: (error as Error)?.message || 'OCR.space service unavailable' });
  }
});

catalogRouter.post('/scan-tag', async (req: AuthenticatedRequest, res) => {
  const startedAt = Date.now();
  const { imageBase64, side = 'side1', existingCpc } = req.body || {};
  if (!imageBase64) {
    res.status(400).json({ error: 'Missing imageBase64' });
    return;
  }
  if (!config.ocrSpaceApiKey) {
    ocrUnavailable(res);
    return;
  }

  try {
    const { rawText, exitCode } = await runOcr(imageBase64);
    logEvent('ocr.tag_scan', {
      side,
      success: true,
      latencyMs: Date.now() - startedAt,
      exitCode,
      rawTextLength: rawText.length,
    }, actorFrom(req.user));
    res.json({ success: true, rawText, side, cpc: existingCpc || '' });
  } catch (err) {
    console.warn('Free tag scan notice:', (err as Error)?.message || err);
    logEvent('ocr.tag_scan', {
      success: false,
      latencyMs: Date.now() - startedAt,
      errorMessage: debugDetail(err),
    }, actorFrom(req.user));
    res.json({ success: false, rawText: '', error: (err as Error)?.message || 'Free OCR failed' });
  }
});
