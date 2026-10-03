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
