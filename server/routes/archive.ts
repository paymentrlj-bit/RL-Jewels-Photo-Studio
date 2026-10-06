// The Archive: products staff deleted. Staff are told they are gone; they are kept
// so a manager or admin can see what was thrown away and why - a deleted piece is
// almost always a piece whose output was not good. Managers and admins can look and
// restore; only an admin can erase one for good.
import express from 'express';
import { requireAuth, requireManager, requireAdmin, type AuthenticatedRequest } from '../auth/session';
import { logEvent, actorFrom } from '../logging';
import { findUserById } from '../auth/users';
import { listProducts, getProduct, restoreProduct, deleteProduct, type Product } from '../db/products';
import { getLatestPhoto, deleteImagesForProduct } from '../storage/images';
import { categoryOf, weightOf } from '../catalog/filters';
import { findReason } from '../catalog/deletionReasons';
import { AUDIT_CHECK_LABELS_SERVER } from '../reports/dailySummary';
import { getUsdToInrRate } from '../integrations/exchangeRate';

export const archiveRouter = express.Router();

const nameOf = (id: string | null) => (id ? findUserById(id)?.displayName || findUserById(id)?.username || 'Unknown' : null);

function archiveItem(p: Product, usdToInr: number) {
  const failedChecks = Object.entries(p.auditChecklist ?? {})
    .filter(([, ok]) => ok === false)
    .map(([check]) => ({ check, label: AUDIT_CHECK_LABELS_SERVER[check] ?? check }));
  const photo = (kind: 'original' | 'processed' | 'airender' | 'cutout') => getLatestPhoto(p.id, kind)?.id ?? null;
  return {
    id: p.id,
    cpc: p.cpc,
    name: p.name,
    itemType: p.itemType,
    category: categoryOf(p.itemType),
    purity: p.purity,
    weightGrams: weightOf(p),
    createdAt: p.createdAt,
    staffName: nameOf(p.createdBy) ?? 'Unknown',
    archivedAt: p.archivedAt,
    archivedByName: nameOf(p.archivedBy),
    reason: findReason(p.archivedReason).short,
    reasonCode: p.archivedReason,
    reasonNote: p.archivedNote,
    statusWhenDeleted: p.archivedStatus || p.status,
    riskScore: p.riskScore,
    riskTier: p.riskTier,
    riskReasons: p.riskReasons,
    attemptCount: p.attemptCount,
    estimatedCostInr: Number((p.estimatedCostUsd * usdToInr).toFixed(2)),
    modelUsed: p.modelUsed,
    auditReason: p.auditReason,
    reviewNote: p.reviewNote,
    failedChecks,
    photos: { original: photo('original'), processed: photo('processed'), aiRender: photo('airender'), cutout: photo('cutout') },
  };
}

function tally<T>(items: T[], key: (item: T) => string | null | undefined): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

archiveRouter.get('/archive', requireAuth, requireManager, async (_req, res) => {
  const { rate } = await getUsdToInrRate();
  const items = listProducts({ archived: 'only', limit: 500 }).map((p) => archiveItem(p, rate));
  res.json({
    items,
    summary: {
      total: items.length,
      byReason: tally(items, (i) => i.reason),
      byCategory: tally(items, (i) => i.category),
      byStatus: tally(items, (i) => i.statusWhenDeleted),
      byPhotographer: tally(items, (i) => i.staffName),
      byFailedCheck: tally(items.flatMap((i) => i.failedChecks), (c) => c.label),
      byRiskTier: tally(items, (i) => i.riskTier || 'not scored'),
      estimatedCostInr: Number(items.reduce((n, i) => n + (i.estimatedCostInr || 0), 0).toFixed(0)),
    },
  });
});

archiveRouter.post('/archive/:id/restore', requireAuth, requireManager, (req: AuthenticatedRequest, res) => {
  if (!restoreProduct(req.params.id)) {
    res.status(404).json({ error: 'That product is not in the archive.' });
    return;
  }
  logEvent('archive.restored', { productId: req.params.id }, actorFrom(req.user));
  res.json({ success: true });
});

// The only place anything is really deleted. Only an archived product can go, so
// a live one can never be erased by a stale screen or a guessed id.
archiveRouter.delete('/archive/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const product = getProduct(req.params.id, { includeArchived: true });
  if (!product?.archivedAt) {
    res.status(404).json({ error: 'That product is not in the archive.' });
    return;
  }
  deleteImagesForProduct(product.id);
  deleteProduct(product.id);
  logEvent('archive.purged', { productId: product.id, cpc: product.cpc }, actorFrom(req.user));
  res.json({ success: true });
});
