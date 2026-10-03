// The accuracy safeguards: POS "pot" spelling, family comparison, weight
// plausibility, the risk score and the new audit checks.
import { describe, it, expect } from 'vitest';
import { resolveCategory, describeItemType, familyFor, parseLengthInches } from '../catalog/taxonomy';
import { checkWeight } from '../catalog/plausibility';
import { computeRisk } from '../catalog/risk';
import { compareIdentity, parseIdentity } from '../ai/identity';
import { AUDIT_CHECKS, UNFIXABLE_BY_ESCALATION, classifyAuditFailure, buildContextBlock, buildAuditFactsBlock } from '../ai/operations';
import { buildAuditPrompt, buildNaturalArrangementBlock } from '../ai/prompts';
import { hiddenElements, parseInventory } from '../ai/inventory';

describe('"pot" is pote, not earrings or a vessel', () => {
  it.each(['LONG PATTI POT', 'Long chain pot', 'PATTI POT', 'SHORT NANO POT', 'POT'])('%s is a mangalsutra', (name) => {
    expect(resolveCategory(name)?.type).toBe('Mangalsutra');
  });

  it('leaves silver and puja pots alone', () => {
    expect(resolveCategory('.POT SILVER')?.type).not.toBe('Mangalsutra');
    expect(resolveCategory('PUJA POT')?.type).not.toBe('Mangalsutra');
    expect(describeItemType('.POT SILVER').notes ?? '').not.toMatch(/black glass beads/);
  });

  it('carries the black-bead rule on pieces that merely contain pot', () => {
    expect(describeItemType('SHORT BRACLET POT').notes).toMatch(/black/i);
  });
});

describe('product family', () => {
  it('keeps a mangalsutra apart from earrings and chains', () => {
    expect(familyFor('Long chain pot')).toBe('mangalsutra');
    expect(familyFor('Jhumka')).toBe('earring');
    expect(familyFor('Rani Har')).toBe('neckpiece');
    expect(familyFor('Gold coin')).toBe('other');
    expect(familyFor('xyzzy')).toBeNull();
  });

  it('asks about a clear mismatch, and about a photo the AI cannot read', () => {
    const earrings = parseIdentity({ family: 'earring', description: 'pair of studs', pieceCount: 2, hasBlackBeads: false, confidence: 'high' });
    expect(compareIdentity('Long chain pot', earrings).status).toBe('mismatch');
    const strand = parseIdentity({ family: 'mangalsutra', description: 'patti pote', pieceCount: 1, hasBlackBeads: true, confidence: 'high' });
    expect(compareIdentity('Long chain pot', strand).status).toBe('match');
    const unsure = parseIdentity({ family: 'earring', description: '?', confidence: 'low' });
    expect(compareIdentity('Long chain pot', unsure).status).toBe('unsure');
    expect(compareIdentity('Long chain pot', null).status).toBe('unchecked');
  });

  it('never raises a mismatch for sets, coins or unknown forms', () => {
    const earrings = parseIdentity({ family: 'earring', confidence: 'high' });
    expect(compareIdentity('Bridal Set', earrings).status).toBe('unchecked');
    expect(compareIdentity('xyzzy', earrings).status).toBe('unchecked');
  });

  it('rejects an answer that is not a known family', () => {
    expect(parseIdentity({ family: 'spaceship' })).toBeNull();
    expect(parseIdentity(null)).toBeNull();
  });
});

describe('length from the CPC size name', () => {
  it('reads inches', () => {
    expect(parseLengthInches('28INCH')).toBe(28);
    expect(parseLengthInches('18 inch')).toBe(18);
    expect(parseLengthInches('DEFAULT')).toBeNull();
    expect(parseLengthInches('2.4')).toBeNull();
  });
});

describe('weight plausibility', () => {
  it('flags a slipped decimal', () => {
    expect(checkWeight('Ring', 0.2).status).toBe('low');
    expect(checkWeight('Ring', 180).status).toBe('high');
    expect(checkWeight('Ring', 6.5).status).toBe('ok');
    expect(checkWeight('Haar', '42.5').status).toBe('ok');
  });
  it('says nothing when it cannot judge', () => {
    expect(checkWeight('xyzzy', 5).status).toBe('unknown');
    expect(checkWeight('Ring', '').status).toBe('unknown');
    expect(checkWeight('Ring', 0).status).toBe('unknown');
  });
});

describe('risk score', () => {
  it('is low for a plain, plausible piece', () => {
    expect(computeRisk({ itemType: 'Ring', weight: 6, inventoryRan: true }).tier).toBe('low');
  });
  it('is high for a mismatched long strand with a bad weight', () => {
    const r = computeRisk({ itemType: 'Long chain pot', size: '28INCH', weight: 0.5, inventoryRan: false, identity: 'mismatch' });
    expect(r.tier).toBe('high');
    expect(r.reasons.join(' ')).toMatch(/does not look like/);
  });
  it('is capped for a real-photo cut-out', () => {
    expect(computeRisk({ itemType: 'Long chain pot', size: '28INCH', renderMode: 'faithful' }).score).toBeLessThanOrEqual(20);
  });
});

describe('audit', () => {
  it('has the two new fidelity checks, neither fixable by a stronger model', () => {
    for (const key of ['sameProductFamily', 'pieceCountMatches'] as const) {
      expect(AUDIT_CHECKS).toContain(key);
      expect(UNFIXABLE_BY_ESCALATION).toContain(key);
    }
    const all = Object.fromEntries(AUDIT_CHECKS.map((c) => [c, true])) as Record<(typeof AUDIT_CHECKS)[number], boolean>;
    all.sameProductFamily = false;
    expect(classifyAuditFailure(all).escalate).toBe(false);
  });

  it('allows natural straightening and pairs the same colour, and asks for the new checks', () => {
    const prompt = buildAuditPrompt({ itemType: 'Rani Har', purity: '22kt', facts: 'FACTS' });
    expect(prompt).toMatch(/natural way they hang/);
    expect(prompt).toMatch(/Matching pairs/);
    expect(prompt).toMatch(/"sameProductFamily"/);
    expect(prompt).toMatch(/FACTS/);
  });

  it('tells the enhancer placement may be corrected but never the design', () => {
    const block = buildNaturalArrangementBlock();
    expect(block).toMatch(/placement only/);
    expect(block).toMatch(/same order, count, size and colour/);
  });
});

describe('facts handed to the AI', () => {
  it('includes length and weight but keeps the photo as the final truth', () => {
    const block = buildContextBlock({ itemType: 'Long chain pot', purity: '22kt', gender: "women's", weight: '38.2', lengthInches: 28 });
    expect(block).toMatch(/Length: about 28 inches/);
    expect(block).toMatch(/Weight: 38.2g/);
    expect(block).toMatch(/PHOTO is the final truth/);
  });
  it('tells the audit what the original really is', () => {
    const identity = parseIdentity({ family: 'mangalsutra', description: 'patti pote', pieceCount: 1, hasBlackBeads: true, confidence: 'high' });
    expect(buildAuditFactsBlock({ identity, lengthInches: 28 })).toMatch(/mangalsutra/);
    expect(buildAuditFactsBlock({})).toBe('');
  });
});

describe('hidden detail', () => {
  it('flags a bead group the inspector could not count at all', () => {
    const inv = parseInventory({ elements: [{ feature: 'black bead string', count: null, countConfidence: 'low' }, { feature: 'matte texture', count: null, countConfidence: 'low' }] });
    expect(hiddenElements(inv!).map((e) => e.feature)).toEqual(['black bead string']);
  });
});

import { summariseOutcomes } from '../catalog/outcomes';

describe('approval rate by category', () => {
  const row = (itemType: string, status: string, riskTier = 'low', riskScore: number | null = 10) => ({ itemType, status, riskTier, riskScore });

  it('counts approved against reshoot, ignores pieces still waiting, and lists the weakest first', () => {
    const { byCategory } = summariseOutcomes([
      row('Ring', 'approved'), row('Ring', 'exported'), row('Ring', 'needs_reshoot'), row('Ring', 'awaiting_review'),
      row('Long chain pot', 'needs_reshoot', 'high', 80), row('Long chain pot', 'failed', 'high', 90),
      row('xyzzy', 'queued'),
    ]);
    expect(byCategory[0]).toMatchObject({ label: 'Mangalsutra', approved: 0, reshoot: 2, approvalRate: 0, avgRisk: 85 });
    expect(byCategory.find((g) => g.label === 'Ring')).toMatchObject({ total: 4, approved: 2, reshoot: 1, approvalRate: 66.7 });
    expect(byCategory.find((g) => g.label === 'Not recognised')?.approvalRate).toBeNull();
  });

  it('splits by risk tier so the score can be checked against reality', () => {
    const { byRiskTier } = summariseOutcomes([row('Ring', 'approved', 'low'), row('Ring', 'needs_reshoot', 'high', 70)]);
    expect(byRiskTier.map((g) => [g.label, g.approvalRate])).toEqual([['low', 100], ['high', 0]]);
  });
});
