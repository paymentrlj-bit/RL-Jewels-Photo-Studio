// The end-of-day picture for the people who run the studio: what was shot, by
// whom, what is waiting on a manager, and what needs a retake. Built from the
// database on demand, so the Admin screen, a copied WhatsApp message and any
// future scheduled sender all say exactly the same thing.
import { getDb } from '../db';
import { istDate } from '../db/products';
import { summariseStaff, type StaffScore } from '../catalog/outcomes';

export interface DailySummary {
  /** d/m/yyyy, India time. */
  date: string;
  shot: number;
  approvedToday: number;
  sentBackToday: number;
  /** Right now, not only today's. */
  waitingForApproval: number;
  oldestWaitingHours: number | null;
  toRetake: number;
  needAngle: number;
  failed: number;
  estCostUsd: number;
  byPhotographer: StaffScore[];
  /** The audit check that failed most across today's pieces. */
  topProblem: { check: string; count: number } | null;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** UTC instants bounding an India-time calendar day. `day` is d/m/yyyy; omitted = today. */
export function istDayRange(day?: string): { startIso: string; endIso: string; label: string } {
  const label = day ?? istDate();
  const [d, m, y] = label.split('/').map(Number);
  const start = Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
  return { startIso: new Date(start).toISOString(), endIso: new Date(start + 24 * 3600 * 1000).toISOString(), label };
}

export function buildDailySummary(day?: string): DailySummary {
  const db = getDb();
  const { startIso, endIso, label } = istDayRange(day);

  const todays = db
    .prepare(
      `SELECT p.created_by AS user_id, COALESCE(NULLIF(u.display_name, ''), u.username, 'Unknown') AS name,
              p.status, p.risk_score, p.audit_checklist, p.estimated_cost_usd
         FROM products p LEFT JOIN users u ON u.id = p.created_by
        WHERE p.created_at >= ? AND p.created_at < ? AND p.status != 'draft'`
    )
    .all(startIso, endIso) as { user_id: string; name: string; status: string; risk_score: number | null; audit_checklist: string | null; estimated_cost_usd: number }[];

  const rows = todays.map((r) => {
    let checklist: Record<string, boolean> | null = null;
    try {
      checklist = r.audit_checklist ? JSON.parse(r.audit_checklist) : null;
    } catch {
      checklist = null;
    }
    return { userId: r.user_id, name: r.name, status: r.status, riskScore: r.risk_score, checklist };
  });

  const failures = new Map<string, number>();
  for (const r of rows) for (const [check, ok] of Object.entries(r.checklist ?? {})) if (ok === false) failures.set(check, (failures.get(check) ?? 0) + 1);
  const top = [...failures].sort((a, b) => b[1] - a[1])[0];

  const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const oldest = db.prepare("SELECT MIN(updated_at) AS at FROM products WHERE status = 'awaiting_review'").get() as { at: string | null };

  return {
    date: label,
    shot: rows.length,
    approvedToday: count('SELECT COUNT(*) AS n FROM products WHERE approved_at >= ? AND approved_at < ?', startIso, endIso),
    sentBackToday: count("SELECT COUNT(*) AS n FROM events WHERE type = 'product.rejected' AND at >= ? AND at < ?", startIso, endIso),
    waitingForApproval: count("SELECT COUNT(*) AS n FROM products WHERE status = 'awaiting_review'"),
    oldestWaitingHours: oldest.at ? Math.max(0, Math.round((Date.now() - new Date(oldest.at).getTime()) / 36e5)) : null,
    toRetake: count("SELECT COUNT(*) AS n FROM products WHERE status = 'needs_reshoot'"),
    needAngle: count("SELECT COUNT(*) AS n FROM products WHERE status = 'needs_angle'"),
    failed: count("SELECT COUNT(*) AS n FROM products WHERE status = 'failed'"),
    estCostUsd: Number(todays.reduce((n, r) => n + (r.estimated_cost_usd || 0), 0).toFixed(2)),
    byPhotographer: summariseStaff(rows),
    topProblem: top ? { check: top[0], count: top[1] } : null,
  };
}

/** Plain text that reads well pasted into WhatsApp, Telegram or an email. */
export function renderSummaryText(s: DailySummary, labels: Record<string, string> = {}): string {
  const lines = [
    `*RL Jewels Studio - ${s.date}*`,
    '',
    `Shot today: ${s.shot}`,
    `Approved today: ${s.approvedToday}${s.sentBackToday ? ` | Sent back today: ${s.sentBackToday}` : ''}`,
    `Waiting for approval: ${s.waitingForApproval}${s.oldestWaitingHours !== null && s.waitingForApproval > 0 ? ` (oldest ${s.oldestWaitingHours}h)` : ''}`,
    `To retake: ${s.toRetake}${s.needAngle ? ` | Need another photo: ${s.needAngle}` : ''}${s.failed ? ` | Processing errors: ${s.failed}` : ''}`,
  ];
  if (s.byPhotographer.length) {
    lines.push('', '*By person*');
    for (const p of s.byPhotographer) {
      lines.push(`${p.name}: ${p.shot} shot, ${p.approved} approved, ${p.reshoot} sent back${p.needAngle ? `, ${p.needAngle} need another photo` : ''}`);
    }
  }
  if (s.topProblem) lines.push('', `Most common problem today: ${labels[s.topProblem.check] ?? s.topProblem.check} (${s.topProblem.count})`);
  lines.push('', `AI cost today (estimate): $${s.estCostUsd.toFixed(2)}`);
  return lines.join('\n');
}

/** Staff-facing names for audit checks, for the text version (the screen has its own copy). */
export const AUDIT_CHECK_LABELS_SERVER: Record<string, string> = {
  sharpFocus: 'photo is blurry',
  notCropped: 'part of the piece cut off',
  backgroundCleanWhite: 'background not clean white',
  noBlownHighlights: 'harsh glare on the piece',
  neutralWhiteBalance: 'colour too yellow or blue',
  colorConsistentAcrossSurface: 'uneven colour',
  clearlyIdentifiableCategory: 'hard to tell what it is',
  stoneCountMatches: 'stone count changed',
  beadDetailPreserved: 'bead count changed',
  chainPatternMatches: 'chain pattern changed',
  engravingPreserved: 'engraving changed',
  naturalDropPhysics: 'does not hang naturally',
  sameProductFamily: 'turned into a different product',
  pieceCountMatches: 'number of pieces or pendant changed',
};
