// Approval rate by category (and by risk tier) from where products actually
// ended up. "Decided" is what a person or the AI has settled: approved or
// exported counts as a win, needs_reshoot or failed as a loss; pieces still in
// the pipeline or waiting for review are not counted either way.
import { resolveCategory } from './taxonomy';

export interface OutcomeRow {
  itemType: string;
  status: string;
  riskTier: string;
  riskScore: number | null;
}

export interface OutcomeGroup {
  label: string;
  total: number;
  approved: number;
  reshoot: number;
  /** approved / (approved + reshoot); null until something is decided. */
  approvalRate: number | null;
  avgRisk: number | null;
}

const WON = new Set(['approved', 'exported']);
const LOST = new Set(['needs_reshoot', 'failed']);

function group(label: string, rows: OutcomeRow[]): OutcomeGroup {
  const approved = rows.filter((r) => WON.has(r.status)).length;
  const reshoot = rows.filter((r) => LOST.has(r.status)).length;
  const scored = rows.filter((r) => r.riskScore !== null);
  return {
    label,
    total: rows.length,
    approved,
    reshoot,
    approvalRate: approved + reshoot > 0 ? Number(((approved / (approved + reshoot)) * 100).toFixed(1)) : null,
    avgRisk: scored.length ? Math.round(scored.reduce((n, r) => n + (r.riskScore ?? 0), 0) / scored.length) : null,
  };
}

export function summariseOutcomes(rows: OutcomeRow[]): { byCategory: OutcomeGroup[]; byRiskTier: OutcomeGroup[] } {
  const cats = new Map<string, OutcomeRow[]>();
  for (const r of rows) {
    const label = resolveCategory(r.itemType)?.type ?? 'Not recognised';
    cats.set(label, [...(cats.get(label) ?? []), r]);
  }
  // Weakest first: the categories worth attention are the ones losing most.
  const byCategory = [...cats].map(([label, rs]) => group(label, rs)).sort((a, b) => (a.approvalRate ?? 101) - (b.approvalRate ?? 101) || b.total - a.total);
  const byRiskTier = (['low', 'medium', 'high'] as const)
    .map((tier) => group(tier, rows.filter((r) => r.riskTier === tier)))
    .filter((g) => g.total > 0);
  return { byCategory, byRiskTier };
}

// ---------------------------------------------------------------------------
// Staff scorecard: how each person's shoots turn out. A coaching tool, not a
// league table - rates over a handful of pieces mean little, so each row says
// how many it rests on.
// ---------------------------------------------------------------------------

export interface StaffRow {
  userId: string;
  name: string;
  status: string;
  riskScore: number | null;
  /** Audit checklist as stored, or null. */
  checklist: Record<string, boolean> | null;
}

export interface StaffScore {
  userId: string;
  name: string;
  shot: number;
  approved: number;
  reshoot: number;
  /** Pieces the pipeline stopped on to ask for another photo. */
  needAngle: number;
  approvalRate: number | null;
  avgRisk: number | null;
  /** The audit check that failed most often on their pieces, with its count. */
  topIssue: { check: string; count: number } | null;
  /** Fewer than FEW_SHOTS pieces: do not read much into the rates. */
  fewShots: boolean;
}

export const FEW_SHOTS = 10;

export function summariseStaff(rows: StaffRow[]): StaffScore[] {
  const byUser = new Map<string, StaffRow[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  const out: StaffScore[] = [];
  for (const [userId, rs] of byUser) {
    const base = group('', rs.map((r) => ({ itemType: '', status: r.status, riskTier: '', riskScore: r.riskScore })));
    const failures = new Map<string, number>();
    for (const r of rs) for (const [check, ok] of Object.entries(r.checklist ?? {})) if (ok === false) failures.set(check, (failures.get(check) ?? 0) + 1);
    const top = [...failures].sort((a, b) => b[1] - a[1])[0];
    out.push({
      userId,
      name: rs[0].name,
      shot: rs.length,
      approved: base.approved,
      reshoot: base.reshoot,
      needAngle: rs.filter((r) => r.status === 'needs_angle').length,
      approvalRate: base.approvalRate,
      avgRisk: base.avgRisk,
      topIssue: top ? { check: top[0], count: top[1] } : null,
      fewShots: rs.length < FEW_SHOTS,
    });
  }
  // Most pieces first: the people doing the work come first, not the best or worst rate.
  return out.sort((a, b) => b.shot - a.shot);
}
