// Background workers that drain the job queue.
//
// The pipeline logic here - segment, enhance, audit, escalate once on failure,
// audit again - is ported from v1's /api/audit-and-enhance and behaves
// identically. What changed is where it runs: in a worker loop with no HTTP
// request attached, writing progress to the jobs table instead of streaming
// NDJSON to a browser that has to stay open.

import { config, isGeminiConfigured } from '../config';
import {
  getGeminiClient,
  withTransientRetry,
  isTransientError,
  isBillingError,
  isModelNotFoundError,
  debugDetail,
  COST_PER_CALL_USD,
  MODEL_ENHANCE_DEFAULT,
  MODEL_ENHANCE_ESCALATED,
  MODEL_AUDIT,
  MODEL_AUDIT_STRONG,
  MODEL_SEGMENT,
  MODEL_COPY,
  ENABLE_SEGMENTATION_GROUNDING,
  PIPELINE_BUDGET_MS,
  type RetryAttemptInfo,
} from '../ai/client';
import {
  enhanceImage,
  auditOutput,
  segmentJewelry,
  generateCopy,
  buildContextBlock,
  buildSegmentationBlock,
  classifyAuditFailure,
  type EnhanceResult,
  type AuditResult,
} from '../ai/operations';
import { buildOutputFramingBlock } from '../ai/prompts';
import {
  analyzeDetail,
  cropDetailRegions,
  hiddenElements,
  buildAngleRequestReason,
  MAX_ANGLE_PHOTOS,
  buildInventoryBlock,
  buildReferenceImagesBlock,
  type DetailInventory,
  type ReferenceImage,
} from '../ai/inventory';
import { aspectRatioFor, describeItemType } from '../catalog/taxonomy';
import { cachedSegmentation, cachedInventory } from './groundingCache';
import { getEnhancePrompt } from '../settings';
import { logEvent, newRequestId } from '../logging';
import {
  claimNextJob,
  completeJob,
  failJob,
  setJobStage,
  enqueueJob,
  recoverOrphanedJobs,
  type Job,
} from './jobs';
import {
  getProduct,
  setProductStatus,
  recordAuditResult,
  applyGeneratedCopy,
} from '../db/products';
import { getLatestPhoto, listPhotos, saveImage, readImageBase64, readImageBuffer, imageExists } from '../storage/images';

let running = false;
let activeWorkers = 0;
const workerTimers: ReturnType<typeof setTimeout>[] = [];

// How long a worker waits before re-checking an empty queue. Short enough
// that a staff member watching the screen sees work start promptly, long
// enough that an idle store isn't spinning the database all day.
const IDLE_POLL_MS = 1000;

export function startWorkers(): void {
  if (running) return;
  running = true;

  const recovered = recoverOrphanedJobs();
  if (recovered > 0) {
    console.log(`[queue] recovered ${recovered} job(s) left running by a previous process.`);
    logEvent('queue.recovered_orphans', { count: recovered });
  }

  for (let i = 0; i < config.queueConcurrency; i++) {
    void workerLoop(`worker-${i + 1}`);
  }
  console.log(`[queue] ${config.queueConcurrency} worker(s) started.`);
}

export async function stopWorkers(): Promise<void> {
  running = false;
  for (const timer of workerTimers) clearTimeout(timer);
  workerTimers.length = 0;

  // Give in-flight jobs a moment to finish cleanly. Anything still running
  // after this gets recovered at next boot, so nothing is lost either way.
  const deadline = Date.now() + 10_000;
  while (activeWorkers > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function workerLoop(workerId: string): Promise<void> {
  while (running) {
    let job: Job | null = null;
    try {
      job = claimNextJob(workerId);
    } catch (err) {
      console.error(`[queue] ${workerId} could not claim a job:`, (err as Error).message);
    }

    if (!job) {
      await new Promise((r) => {
        const timer = setTimeout(r, IDLE_POLL_MS);
        timer.unref?.();
        workerTimers.push(timer);
      });
      continue;
    }

    activeWorkers++;
    try {
      await runJob(job, workerId);
    } catch (err) {
      // A throw that escapes runJob is a bug rather than an expected failure,
      // but it must never take the worker loop down with it - one bad job
      // would otherwise stall the whole queue.
      console.error(`[queue] ${workerId} crashed on job ${job.id}:`, err);
      const requeued = failJob(job.id, debugDetail(err), isTransientError(err));
      if (!requeued) setProductStatus(job.productId, 'failed');
    } finally {
      activeWorkers--;
    }
  }
}

async function runJob(job: Job, workerId: string): Promise<void> {
  if (!isGeminiConfigured()) {
    failJob(job.id, 'GEMINI_API_KEY is not configured on the server.', false);
    setProductStatus(job.productId, 'failed');
    return;
  }

  if (job.type === 'enhance') {
    await runEnhanceJob(job, workerId);
    return;
  }
  if (job.type === 'copy') {
    await runCopyJob(job, workerId);
    return;
  }

  failJob(job.id, `Unknown job type "${job.type}".`, false);
}

// ---------------------------------------------------------------------------
// The enhance pipeline. Ported from v1's /api/audit-and-enhance.
// ---------------------------------------------------------------------------

async function runEnhanceJob(job: Job, workerId: string): Promise<void> {
  const product = getProduct(job.productId);
  if (!product) {
    failJob(job.id, 'Product no longer exists.', false);
    return;
  }

  const originalPhoto = getLatestPhoto(product.id, 'original');
  if (!originalPhoto || !imageExists(originalPhoto)) {
    failJob(job.id, 'The original photo for this product is missing.', false);
    setProductStatus(product.id, 'failed');
    return;
  }

  setProductStatus(product.id, 'processing');

  const requestId = newRequestId();
  const pipelineStart = Date.now();
  const deadline = pipelineStart + PIPELINE_BUDGET_MS;
  let estimatedCostUsd = 0;
  let apiCallCount = 0;
  // Recorded on every pipeline.completed event, so reshoot rates with and
  // without the detail inventory can be compared directly in Axiom.
  let detailInventoryUsed = false;
  let referenceImageCount = 0;

  const originalBuffer = readImageBuffer(originalPhoto);
  const cleanBase64 = originalBuffer.toString('base64');
  const mimeType = originalPhoto.mimeType;

  // Extra photos of this piece from other angles, taken after the current
  // original (older ones belong to a previous shoot of it).
  const angles: ReferenceImage[] = listPhotos(product.id)
    .filter((p) => p.kind === 'angle' && p.createdAt >= originalPhoto.createdAt && imageExists(p))
    .slice(-MAX_ANGLE_PHOTOS)
    .map((p) => ({ base64: readImageBase64(p), mimeType: p.mimeType, label: 'another angle of the same piece', kind: 'angle' as const }));

  logEvent('pipeline.started', {
    requestId,
    jobId: job.id,
    productId: product.id,
    workerId,
    itemType: product.itemType || null,
    purity: product.purity || null,
    gender: product.gender || null,
    cpc: product.cpc || null,
    imageBytesApprox: originalPhoto.bytes,
    segmentationEnabled: ENABLE_SEGMENTATION_GROUNDING,
    detailInventoryEnabled: config.detailInventory,
    anglePhotos: angles.length,
    attempt: job.attempts,
  });

  // Every Gemini attempt funnels through here, so retry/timeout/latency
  // patterns per stage+model are always captured - the single richest signal
  // for spotting flakiness or a stage getting slower over time.
  const recordAttempt = (stage: string, model: string) => (info: RetryAttemptInfo) => {
    apiCallCount++;
    estimatedCostUsd += COST_PER_CALL_USD[model] || 0;
    const timedOut =
      (info.error as Error)?.name === 'AbortError' ||
      /aborted/i.test(String((info.error as Error)?.message || ''));
    logEvent('pipeline.api_call', {
      requestId,
      stage,
      model,
      attempt: info.attempt,
      latencyMs: info.latencyMs,
      success: info.success,
      timedOut,
      errorType: info.success ? undefined : (info.error as { name?: string })?.name || 'error',
      errorMessage: info.success ? undefined : debugDetail(info.error),
    });
  };

  const finish = (
    status: 'awaiting_review' | 'needs_angle' | 'needs_reshoot' | 'failed',
    detail: { reason: string; checklist?: AuditResult['checklist'] | null; modelUsed?: string; attemptCount?: number; retryable?: boolean }
  ) => {
    logEvent('pipeline.completed', {
      requestId,
      jobId: job.id,
      productId: product.id,
      status,
      reason: detail.reason,
      totalLatencyMs: Date.now() - pipelineStart,
      apiCallCount,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
      modelUsed: detail.modelUsed,
      attemptCount: detail.attemptCount,
      itemType: product.itemType || null,
      resolvedCategory: describeItemType(product.itemType).line,
      purity: product.purity || null,
      detailInventoryUsed,
      referenceImageCount,
      anglePhotos: angles.length,
    });

    recordAuditResult(product.id, {
      checklist: detail.checklist ?? null,
      reason: detail.reason,
      modelUsed: detail.modelUsed ?? '',
      attemptCount: detail.attemptCount ?? job.attempts,
      estimatedCostUsd,
    });
  };

  const ai = getGeminiClient();
  const promptTemplate = getEnhancePrompt();
  const contextBlock = buildContextBlock({
    itemType: product.itemType,
    purity: product.purity,
    gender: product.gender,
    weight: product.netWeightGrams || product.grossWeightGrams,
  });

  // Branched by category. An elongated piece forced into a square is either
  // cropped or shrunk to a thread in a white field - see taxonomy.ts.
  const aspectRatio = aspectRatioFor(product.itemType);
  const framingBlock = buildOutputFramingBlock(aspectRatio, product.itemType);
  const auditContext = {
    itemType: product.itemType || 'jewellery',
    purity: product.purity || '22kt',
  };

  // Non-blocking grounding call. Fails open: if it errors or times out,
  // segmentationBlock stays empty and the pipeline behaves exactly as it
  // would have without the feature.
  const runSegmentation = async (): Promise<string> => {
    if (!ENABLE_SEGMENTATION_GROUNDING) return '';
    const segmentStartedAt = Date.now();
    // Deduped by image hash: a "regenerate" or a requeue on the same photo
    // re-uses the outline instead of paying for it again.
    const { result: segmentation, cacheHit } = await cachedSegmentation(
      cleanBase64,
      () => segmentJewelry(ai, cleanBase64, mimeType)
    );
    if (!cacheHit) {
      apiCallCount++;
      estimatedCostUsd += COST_PER_CALL_USD[MODEL_SEGMENT] || 0;
    }
    logEvent('pipeline.segmentation', {
      requestId,
      found: Boolean(segmentation),
      cacheHit,
      latencyMs: Date.now() - segmentStartedAt,
    });
    return segmentation ? buildSegmentationBlock(segmentation) : '';
  };

  // The detail inventory (ai/inventory.ts): close-ups of the intricate areas
  // plus a verified count of the fine detail, which the enhance call and the
  // audit both treat as ground truth. Fails open exactly like segmentation -
  // any error and the pipeline runs as it did before this stage existed.
  const item = describeItemType(product.itemType);
  const runInventory = async (): Promise<{ inventory: DetailInventory; crops: ReferenceImage[] } | null> => {
    if (!config.detailInventory) return null;
    const startedAt = Date.now();
    try {
      const fresh: { crops?: ReferenceImage[] } = {};
      // Keyed on the angle photos too: adding an angle must produce a fresh
      // count, not the cached one that could not see round the obstruction.
      const cacheKey = [cleanBase64, ...angles.map((a) => a.base64)].join('|');
      const { result: analysis, cacheHit } = await cachedInventory(cacheKey, async () => {
        const out = await analyzeDetail(
          ai,
          { buffer: originalBuffer, base64: cleanBase64, mimeType },
          { itemLine: item.line, itemNotes: item.notes, purity: product.purity || '22kt' },
          { deadline, onAttempt: recordAttempt },
          angles
        );
        fresh.crops = out.crops;
        return out.analysis;
      });
      // On a cache hit only the (small) regions were remembered - re-crop
      // locally, which is free, rather than holding image data in memory.
      const crops = fresh.crops ?? (await cropDetailRegions(originalBuffer, analysis.regions)).map((c) => c.crop);
      logEvent('pipeline.inventory', {
        requestId,
        found: true,
        cacheHit,
        latencyMs: Date.now() - startedAt,
        closeUps: crops.length,
        closeUpLabels: crops.map((c) => c.label),
        elementCount: analysis.inventory.elements.length,
        referenceScalePresent: analysis.inventory.referenceScale.present,
        // The inventory itself, so what the inspector counted can later be
        // compared against what staff say the piece really has.
        inventory: JSON.stringify(analysis.inventory).slice(0, 3000),
      });
      return { inventory: analysis.inventory, crops };
    } catch (err) {
      logEvent('pipeline.inventory', {
        requestId,
        found: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: debugDetail(err),
      });
      return null;
    }
  };

  setJobStage(job.id, config.detailInventory ? 'inspecting' : 'segmenting');
  const [segmentationBlock, detail] = await Promise.all([runSegmentation(), runInventory()]);

  detailInventoryUsed = Boolean(detail);

  // Part of the piece hidden, and nobody has added another angle yet: stop
  // here and ask for one. This is the cheapest point to do it - before the
  // enhancement is paid for - and the likeliest moment the piece is still at
  // the counter. Staff can always choose "Process anyway", which requeues with
  // skipAngleRequest set.
  const hidden = detail ? hiddenElements(detail.inventory) : [];
  if (config.angleRequests && hidden.length > 0 && angles.length === 0 && job.payload.skipAngleRequest !== true) {
    const reason = buildAngleRequestReason(hidden);
    logEvent('pipeline.angle_requested', {
      requestId,
      productId: product.id,
      hiddenFeatures: hidden.map((e) => e.feature),
      itemType: product.itemType || null,
    });
    finish('needs_angle', { reason, attemptCount: 0 });
    setProductStatus(product.id, 'needs_angle');
    completeJob(job.id, 'needs_reshoot', { reason: 'needs_angle' });
    return;
  }

  const inventoryBlock = detail ? buildInventoryBlock(detail.inventory) : '';
  // Angles first: they carry information the close-ups cannot (they are just
  // the original's pixels, enlarged). Capped so the image model is never sent
  // more reference images than it reliably handles.
  const allRefs: ReferenceImage[] = [...angles, ...(detail?.crops ?? [])];
  const auditGrounding = detail ? { inventory: detail.inventory, crops: allRefs } : undefined;
  let enhanceRefs: ReferenceImage[] = allRefs.slice(0, 4);
  const buildEnhancePrompt = (refs: ReferenceImage[]) =>
    promptTemplate + contextBlock + segmentationBlock + inventoryBlock + buildReferenceImagesBlock(refs) + framingBlock;

  const runEnhance = (model: string, stage: string, prompt: string, refs: ReferenceImage[]) =>
    withTransientRetry(
      () => enhanceImage(ai, model, cleanBase64, mimeType, prompt, aspectRatio, refs),
      3,
      deadline,
      recordAttempt(stage, model)
    );

  // --- Attempt 1: default (cheap/fast) tier ---
  let enhanced: EnhanceResult | null = null;
  try {
    setJobStage(job.id, 'enhancing');
    try {
      enhanced = await runEnhance(MODEL_ENHANCE_DEFAULT, 'enhance', buildEnhancePrompt(enhanceRefs), enhanceRefs);
    } catch (err) {
      // The close-ups are extra input images. If the model rejects the request
      // outright - not a hiccup, not billing - try once without them rather
      // than failing a photo that would have processed fine before they existed.
      if (enhanceRefs.length === 0 || isBillingError(err) || isTransientError(err)) throw err;
      logEvent('pipeline.references_rejected', {
        requestId,
        model: MODEL_ENHANCE_DEFAULT,
        referenceCount: enhanceRefs.length,
        errorMessage: debugDetail(err),
      });
      enhanceRefs = [];
      enhanced = await runEnhance(MODEL_ENHANCE_DEFAULT, 'enhance', buildEnhancePrompt(enhanceRefs), enhanceRefs);
    }
    referenceImageCount = enhanceRefs.length;
  } catch (err) {
    if (isBillingError(err)) {
      finish('failed', { reason: 'The Gemini account has hit its billing/spend cap. An admin needs to raise it before photos can be processed.' });
      completeJob(job.id, 'failed', { reason: 'billing_cap' });
      failJob(job.id, debugDetail(err), false);
      setProductStatus(product.id, 'failed');
      return;
    }
    const retryable = isTransientError(err);
    finish('failed', { reason: 'Enhancement service did not respond.', retryable });
    if (!failJob(job.id, debugDetail(err), retryable)) {
      setProductStatus(product.id, 'failed');
    } else {
      setProductStatus(product.id, 'queued');
    }
    return;
  }

  if (!enhanced) {
    finish('failed', { reason: 'The model did not return an edited image.' });
    if (!failJob(job.id, 'The model did not return an edited image.', true)) {
      setProductStatus(product.id, 'failed');
    } else {
      setProductStatus(product.id, 'queued');
    }
    return;
  }

  setJobStage(job.id, 'auditing');
  let audit = await withTransientRetry(
    () => auditOutput(ai, cleanBase64, mimeType, enhanced!.imageBase64, enhanced!.mimeType, auditContext, MODEL_AUDIT, auditGrounding),
    3,
    deadline,
    recordAttempt('audit', MODEL_AUDIT)
  );
  let modelUsed = MODEL_ENHANCE_DEFAULT;
  let attemptCount = 1;

  logEvent('pipeline.audit_verdict', {
    requestId,
    attempt: 1,
    overallPass: audit.overallPass,
    reason: audit.reason,
    checklist: audit.checklist,
    // Surfaced so a model that contradicts its own checklist is visible in the
    // data rather than silently overridden.
    modelClaimedPass: audit.modelClaimedPass,
    verdictDisagreed: audit.verdictDisagreed,
  });

  // --- Classified escalation (spec §5 Stage 3) ---
  //
  // Not every audit failure is worth paying a stronger model for. Failures of
  // the source photo (blurry, cropped) or of design fidelity (a stone was
  // invented) are not capability problems: a better model does not un-blur a
  // photo, and one that already hallucinated a stone is not less likely to do
  // it again for being more expensive. Escalating on exactly those fields
  // measured WORSE than the default tier on real production data.
  //
  // So: classify first, and only spend on the failures a stronger pass can
  // actually fix.
  if (!audit.overallPass) {
    const decision = classifyAuditFailure(audit.checklist);

    if (!decision.escalate) {
      logEvent('pipeline.escalation_skipped', {
        requestId,
        reason: audit.reason,
        failedChecks: decision.failedUnfixable,
        why: 'source-photo or design-fidelity failure - a stronger model cannot fix this',
      });
      finish('needs_reshoot', { reason: audit.reason, checklist: audit.checklist, attemptCount });
      setProductStatus(product.id, 'needs_reshoot');
      completeJob(job.id, 'needs_reshoot', { reason: audit.reason, escalated: false });
      return;
    }

    const correctivePrompt = `${buildEnhancePrompt(enhanceRefs)}

IMPORTANT: A previous attempt at this edit failed quality review for this specific reason:
"${audit.reason}"
Correct this specific issue while still following every rule above.`;

    logEvent('pipeline.escalated', {
      requestId,
      reason: audit.reason,
      failedChecks: decision.failedFixable,
      fromModel: MODEL_ENHANCE_DEFAULT,
      toModel: MODEL_ENHANCE_ESCALATED,
    });

    try {
      setJobStage(job.id, 'escalating');
      const retryEnhanced = await runEnhance(MODEL_ENHANCE_ESCALATED, 'enhance-escalated', correctivePrompt, enhanceRefs);
      attemptCount = 2;

      if (retryEnhanced) {
        setJobStage(job.id, 'auditing');
        // Stronger grader for the re-audit: this is the last gate before a
        // photo ships, and both passes have already been paid for.
        const retryAudit = await withTransientRetry(
          () => auditOutput(ai, cleanBase64, mimeType, retryEnhanced.imageBase64, retryEnhanced.mimeType, auditContext, MODEL_AUDIT_STRONG, auditGrounding),
          3,
          deadline,
          recordAttempt('audit-strong', MODEL_AUDIT_STRONG)
        );
        logEvent('pipeline.audit_verdict', {
          requestId,
          attempt: 2,
          auditModel: MODEL_AUDIT_STRONG,
          overallPass: retryAudit.overallPass,
          reason: retryAudit.reason,
          checklist: retryAudit.checklist,
          modelClaimedPass: retryAudit.modelClaimedPass,
          verdictDisagreed: retryAudit.verdictDisagreed,
        });

        if (retryAudit.overallPass) {
          enhanced = retryEnhanced;
          audit = retryAudit;
          modelUsed = MODEL_ENHANCE_ESCALATED;
        } else {
          finish('needs_reshoot', { reason: retryAudit.reason, checklist: retryAudit.checklist, attemptCount });
          setProductStatus(product.id, 'needs_reshoot');
          completeJob(job.id, 'needs_reshoot', { reason: retryAudit.reason });
          return;
        }
      } else {
        finish('needs_reshoot', { reason: audit.reason, checklist: audit.checklist, attemptCount });
        setProductStatus(product.id, 'needs_reshoot');
        completeJob(job.id, 'needs_reshoot', { reason: audit.reason });
        return;
      }
    } catch (err) {
      // The escalation model being withdrawn is a specific, foreseeable
      // failure (it is a *-preview model) and must not look like a bad photo.
      // Flagging it as failed rather than needs_reshoot keeps staff from
      // rephotographing perfectly good pieces while an admin fixes the model.
      if (isModelNotFoundError(err)) {
        logEvent('pipeline.escalation_model_missing', { requestId, model: MODEL_ENHANCE_ESCALATED, error: debugDetail(err) });
        finish('failed', { reason: `The escalation model "${MODEL_ENHANCE_ESCALATED}" is unavailable. An admin needs to update it - this is not a problem with the photo.` });
        setProductStatus(product.id, 'failed');
        completeJob(job.id, 'failed', { reason: 'escalation_model_missing' });
        return;
      }
      console.error('Escalated retry failed:', (err as Error)?.message || err);
      finish('needs_reshoot', { reason: audit.reason, checklist: audit.checklist, attemptCount });
      setProductStatus(product.id, 'needs_reshoot');
      completeJob(job.id, 'needs_reshoot', { reason: audit.reason });
      return;
    }
  }

  // --- Success: persist the processed image and hand it to a human ---
  const processedPhoto = saveImage({
    productId: product.id,
    kind: 'processed',
    data: enhanced.imageBase64,
    mimeType: enhanced.mimeType,
    source: 'upload',
  });

  finish('awaiting_review', { reason: audit.reason, checklist: audit.checklist, modelUsed, attemptCount });
  setProductStatus(product.id, 'awaiting_review');
  completeJob(job.id, 'succeeded', {
    processedPhotoId: processedPhoto.id,
    modelUsed,
    attemptCount,
    reason: audit.reason,
  });

  // Copy generation is queued rather than run inline so the photo shows up
  // for review the moment it is ready, instead of waiting on a text call the
  // reviewer does not need yet.
  enqueueJob({ productId: product.id, type: 'copy', priority: -1 });
}

// ---------------------------------------------------------------------------
// Catalogue copy. Runs against the PROCESSED photo, as in v1.
// ---------------------------------------------------------------------------

async function runCopyJob(job: Job, workerId: string): Promise<void> {
  const product = getProduct(job.productId);
  if (!product) {
    failJob(job.id, 'Product no longer exists.', false);
    return;
  }

  const photo = getLatestPhoto(product.id, 'processed') || getLatestPhoto(product.id, 'original');
  if (!photo || !imageExists(photo)) {
    failJob(job.id, 'No photo available to write copy from.', false);
    return;
  }

  const startedAt = Date.now();
  setJobStage(job.id, 'writing_copy');

  try {
    const ai = getGeminiClient();
    const copy = await withTransientRetry(
      () =>
        generateCopy(ai, readImageBase64(photo), photo.mimeType, {
          itemType: product.itemType,
          purity: product.purity,
          gender: product.gender,
          size: product.size,
          weight: product.netWeightGrams || product.grossWeightGrams,
        }),
      2
    );

    if (!copy) {
      logEvent('copy.generated', {
        productId: product.id,
        workerId,
        success: false,
        latencyMs: Date.now() - startedAt,
        errorType: 'no_usable_copy',
      });
      failJob(job.id, 'The model did not return usable copy.', true);
      return;
    }

    applyGeneratedCopy(product.id, copy, COST_PER_CALL_USD[MODEL_COPY] || 0);

    logEvent('copy.generated', {
      productId: product.id,
      workerId,
      itemType: product.itemType,
      purity: product.purity,
      success: true,
      latencyMs: Date.now() - startedAt,
      nameLength: copy.name.length,
      descriptionLength: copy.description.length,
      // Tracked so drift off the SEO character limits (metaTitle > 60,
      // metaDescription > 160) shows up as a trend rather than being caught
      // by someone eyeballing one product.
      hasSeoFields: Boolean(copy.metaTitle && copy.metaDescription),
      metaTitleLength: copy.metaTitle.length || null,
      metaDescriptionLength: copy.metaDescription.length || null,
      estimatedCostUsd: COST_PER_CALL_USD[MODEL_COPY] || 0,
    });

    completeJob(job.id, 'succeeded', { name: copy.name });
  } catch (err) {
    logEvent('copy.generated', {
      productId: product.id,
      workerId,
      success: false,
      latencyMs: Date.now() - startedAt,
      errorMessage: debugDetail(err),
    });
    // Copy is a nice-to-have: a product with a photo and no description is
    // still exportable, so this never moves the product itself to failed.
    failJob(job.id, debugDetail(err), isTransientError(err));
  }
}
