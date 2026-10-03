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

import { cleanTags, cleanStaffNote, suggestTags, recordTagsPicked, recordTagsApproved, buildStaffTagsBlock } from '../catalog/tags';
import { nameRulesFor, describeNameRules, sanitizeCopy } from '../catalog/copyRules';
import { shootingTipFor } from '../catalog/shootingTips';
import { buildCopyPrompt } from '../ai/prompts';
import { coverScale, clampCrop, turnedSize, isFullCrop, MIN_CROP } from '../catalog/imageEditMath';
import { beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, closeDatabase } from '../db';

describe('design tags', () => {
  it('cleans what staff type', () => {
    expect(cleanTags(['Black Beads!', 'black  beads', '', 'PATTI', 'a b c d e f'])).toEqual(['black beads', 'patti', 'a b c d']);
    expect(cleanTags('nope')).toEqual([]);
    expect(cleanStaffNote('  both  end stones\nare red  ')).toBe('both end stones are red');
  });

  it('tells the AI what staff said, as hints', () => {
    expect(buildStaffTagsBlock([], '')).toBe('');
    expect(buildStaffTagsBlock(['patti'], 'end stones red')).toMatch(/patti.*end stones red.*photo still decides/s);
  });
});

describe('learned tag vocabulary', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-tags-'));
    initDatabase(path.join(dir, 'test.db'));
  });
  afterAll(() => {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts from the seeds, then lets approved tags outrank them', () => {
    expect(suggestTags('Long chain pot')).toContain('black beads');
    expect(suggestTags('xyzzy')).toEqual([]);
    recordTagsPicked('Mangalsutra', ['gold cages']);
    recordTagsApproved('Mangalsutra', ['gold cages'], ['gold cages', 'tassel']);
    recordTagsApproved('Mangalsutra', [], ['tassel']);
    const tags = suggestTags('Mangalsutra');
    expect(tags.indexOf('tassel')).toBeLessThan(tags.indexOf('black beads'));
    expect(tags.indexOf('gold cages')).toBeLessThan(tags.indexOf('black beads'));
    expect(tags.length).toBeLessThanOrEqual(12);
  });
});

describe('product names', () => {
  it('puts purity and weight in the name only for a coin', () => {
    expect(nameRulesFor('Gold coin')).toMatchObject({ purityInName: true, weightInName: true });
    expect(nameRulesFor('Rani Har')).toMatchObject({ purityInName: false, weightInName: false, lengthInName: false });
    expect(nameRulesFor('Long chain pot').lengthInName).toBe(true);
    expect(describeNameRules('Rani Har', { purity: '22kt', weight: '40' })).toMatch(/never in the name/);
  });

  it('strips the city, store name and weight the model let through', () => {
    const copy = { name: 'RL Jewels Peacock Rani Haar 42.5 gm Jalgaon', description: 'A haar from Jalgaon.', metaTitle: 'Haar Jalgaon', metaDescription: '', imageAltText: '', searchKeywords: 'haar, jalgaon haar', urlSlug: 'jalgaon-peacock-haar' };
    const clean = sanitizeCopy(copy, 'Rani Har');
    expect(clean.name).toBe('Peacock Rani Haar');
    expect(clean.description).not.toMatch(/jalgaon/i);
    expect(clean.searchKeywords).not.toMatch(/jalgaon/i);
    expect(clean.urlSlug).toBe('peacock-haar');
  });

  it('keeps a coin\'s weight', () => {
    const copy = { name: '22kt Gold Coin 10 Gram', description: '', metaTitle: '', metaDescription: '', imageAltText: '', searchKeywords: '', urlSlug: '' };
    expect(sanitizeCopy(copy, 'Gold coin').name).toBe('22kt Gold Coin 10 Gram');
  });

  it('writes from the original photo with the facts, no forced style word, trade words welcome', () => {
    const prompt = buildCopyPrompt({ itemType: 'Long chain pot', purity: '22kt', gender: "women's", size: '28INCH', weight: '38.2', nameRules: '- RULES', tags: ['patti'], staffNote: 'two vati' });
    expect(prompt).toMatch(/ORIGINAL counter photo/);
    expect(prompt).toMatch(/about 28 inches/);
    expect(prompt).toMatch(/patti/);
    expect(prompt).toMatch(/- RULES/);
    expect(prompt).toMatch(/Marathi\/Hindi/);
    expect(prompt).not.toMatch(/Choose exactly ONE style-character word/i);
    expect(prompt).not.toMatch(/Jalgaon.*(include|add)/i);
  });
});

describe('shooting tips', () => {
  it('has a tip for the pieces that go wrong most, and none for the unknown', () => {
    expect(shootingTipFor('Long chain pot')).toMatch(/straight line|gentle U/);
    expect(shootingTipFor('Jhumka')).toMatch(/pair/);
    expect(shootingTipFor('xyzzy')).toBeNull();
  });
});

describe('photo edit geometry', () => {
  it('swaps width and height on a quarter turn', () => {
    expect(turnedSize(4, 3, 1)).toEqual({ w: 3, h: 4 });
    expect(turnedSize(4, 3, 2)).toEqual({ w: 4, h: 3 });
  });
  it('enlarges just enough that a tilted photo has no blank corners', () => {
    expect(coverScale(100, 100, 0)).toBeCloseTo(1);
    expect(coverScale(100, 100, 10)).toBeGreaterThan(1);
    expect(coverScale(200, 100, 10)).toBeGreaterThan(coverScale(100, 100, 10));
  });
  it('keeps a crop inside the photo and not tiny', () => {
    expect(clampCrop({ x: -1, y: 0.95, w: 5, h: 0.5 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
    expect(clampCrop({ x: 0, y: 0, w: 0, h: 0 }).w).toBe(MIN_CROP);
    expect(isFullCrop({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(false);
  });
});

import { buildShareCaption, cleanPrice, formatRupees, hashtagsFrom } from '../sharing/caption';

describe('share caption', () => {
  it('cleans prices and writes them the Indian way', () => {
    expect(cleanPrice('₹ 45,000')).toBe('45000');
    expect(cleanPrice('Rs. 1,25,000.50')).toBe('125000');
    expect(cleanPrice('abc')).toBe('');
    expect(cleanPrice('0')).toBe('');
    expect(formatRupees('125000')).toBe('₹1,25,000');
    expect(formatRupees('950')).toBe('₹950');
    expect(formatRupees('12345')).toBe('₹12,345');
  });

  it('makes hashtags from keywords, letters only', () => {
    expect(hashtagsFrom('peacock jhumka, झुमका, 22kt gold earrings!, one two three four five')).toEqual(['#PeacockJhumka', '#22ktGoldEarrings']);
  });

  it('puts name, description, price and tags together', () => {
    const caption = buildShareCaption({ name: 'Peacock Jhumka', description: 'Gold jhumka.', searchKeywords: 'jhumka', priceInr: '45000' });
    expect(caption).toBe('Peacock Jhumka\n\nGold jhumka.\n\nPrice: ₹45,000\n\n#Jhumka #RLJewels');
    expect(buildShareCaption({ name: 'X', description: '' })).toBe('X\n\n#RLJewels');
  });
});
