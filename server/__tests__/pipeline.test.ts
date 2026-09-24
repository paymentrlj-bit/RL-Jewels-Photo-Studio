import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyAuditFailure,
  AUDIT_CHECKS,
  UNFIXABLE_BY_ESCALATION,
  FIXABLE_BY_ESCALATION,
  buildContextBlock,
  type AuditCheck,
} from '../ai/operations';
import { aspectRatioFor, resolveCategory, defaultGenderFor, isElongated } from '../catalog/taxonomy';
import { cachedSegmentation, clearSegmentationCache, segmentationCacheSize } from '../queue/groundingCache';
import { DEFAULT_ENHANCE_PROMPT, buildOutputFramingBlock, buildAuditPrompt } from '../ai/prompts';

function allPassing(): Record<AuditCheck, boolean> {
  return Object.fromEntries(AUDIT_CHECKS.map((c) => [c, true])) as Record<AuditCheck, boolean>;
}

// ---------------------------------------------------------------------------
// Escalation classification (spec §5 Stage 3)
// ---------------------------------------------------------------------------

describe('classifyAuditFailure', () => {
  it('escalates when only enhancement-quality checks failed', () => {
    const checklist = allPassing();
    checklist.backgroundCleanWhite = false;
    checklist.neutralWhiteBalance = false;

    const decision = classifyAuditFailure(checklist);
    expect(decision.escalate).toBe(true);
    if (decision.escalate) {
      expect(decision.failedFixable).toEqual(['backgroundCleanWhite', 'neutralWhiteBalance']);
    }
  });

  it('refuses to escalate a blurry source photo', () => {
    // A stronger model does not un-blur a photo. Spending on it measured
    // worse than the default tier on real data.
    const checklist = allPassing();
    checklist.sharpFocus = false;

    const decision = classifyAuditFailure(checklist);
    expect(decision.escalate).toBe(false);
  });

  it('refuses to escalate any design-fidelity failure', () => {
    // A model that already invented a stone does not become less likely to
    // invent one by being more expensive.
    for (const check of ['stoneCountMatches', 'beadDetailPreserved', 'chainPatternMatches', 'engravingPreserved'] as const) {
      const checklist = allPassing();
      checklist[check] = false;
      expect(classifyAuditFailure(checklist).escalate, `${check} must not escalate`).toBe(false);
    }
  });

  it('lets an unfixable failure veto escalation even alongside a fixable one', () => {
    // Fixing the background still leaves a cropped photo that has to be
    // retaken, so paying for the escalation buys nothing.
    const checklist = allPassing();
    checklist.notCropped = false;
    checklist.backgroundCleanWhite = false;

    const decision = classifyAuditFailure(checklist);
    expect(decision.escalate).toBe(false);
    if (!decision.escalate) {
      expect(decision.failedUnfixable).toContain('notCropped');
    }
  });

  it('classifies every check into exactly one group', () => {
    const unfixable = new Set<string>(UNFIXABLE_BY_ESCALATION);
    const fixable = new Set<string>(FIXABLE_BY_ESCALATION);

    for (const check of AUDIT_CHECKS) {
      const inUnfixable = unfixable.has(check);
      const inFixable = fixable.has(check);
      expect(inUnfixable !== inFixable, `${check} must be in exactly one group`).toBe(true);
    }
  });

  it('has no umbrella design field left over from v1', () => {
    // The single matchesOriginalDesign boolean was split into four so a
    // failure says WHERE the design changed, not just that it did.
    expect(AUDIT_CHECKS).not.toContain('matchesOriginalDesign' as AuditCheck);
    expect(AUDIT_CHECKS).toContain('stoneCountMatches');
    expect(AUDIT_CHECKS).toContain('beadDetailPreserved');
    expect(AUDIT_CHECKS).toContain('chainPatternMatches');
    expect(AUDIT_CHECKS).toContain('engravingPreserved');
  });
});

// ---------------------------------------------------------------------------
// Category taxonomy and aspect-ratio branching (spec §5 Stage 1, §7, §13)
// ---------------------------------------------------------------------------

describe('aspect ratio branching', () => {
  it('gives elongated pieces the taller frame', () => {
    // Spec §13 names forcing these into a square as a real shipped bug.
    for (const type of ['Chain', 'Necklace', 'Mangalsutra', 'Haar', 'Anklet', 'Bracelet', 'Waist Chain']) {
      expect(aspectRatioFor(type), `${type} must not be square`).toBe('3:4');
    }
  });

  it('keeps compact pieces square', () => {
    for (const type of ['Ring', 'Pendant', 'Jhumka', 'Bangle', 'Kada', 'Nose Pin', 'Stud']) {
      expect(aspectRatioFor(type), `${type} should be square`).toBe('1:1');
    }
  });

  it('resolves the store\'s real messy POS style names', () => {
    expect(resolveCategory('ANGUTHI GENTS')?.type).toBe('Ring');
    expect(resolveCategory('Baccha Kada')?.type).toBe('Kada');
    expect(resolveCategory('BANGLE LADIS')?.type).toBe('Bangle');
    expect(resolveCategory('Zumka Kadi')?.type).toBe('Jhumka');
    expect(resolveCategory('rani haar')?.type).toBe('Haar');
  });

  it('does not let "Chain" swallow "Waist Chain"', () => {
    // Longest-match-first ordering. Both are 3:4 so the ratio survives either
    // way, but the category label would be wrong.
    expect(resolveCategory('Waist Chain')?.type).toBe('Waist Chain');
    expect(resolveCategory('kamarbandh')?.type).toBe('Waist Chain');
  });

  it('does not match a category name embedded inside an unrelated word', () => {
    // "Bali" must not fire on "Balaji" (a deity figurine), and "bar" must not
    // fire on "Barfi". Both are real entries in the store's item list.
    expect(resolveCategory('Balaji')).toBeNull();
    expect(resolveCategory('Barfi')).toBeNull();
  });

  it('falls back to square for an unknown category rather than guessing', () => {
    // Square under-uses the frame; the taller ratio on a compact piece would
    // waste most of it. Square is the safer wrong answer.
    expect(aspectRatioFor('Abhishekpatra')).toBe('1:1');
    expect(aspectRatioFor('')).toBe('1:1');
    expect(isElongated('something unheard of')).toBe(false);
  });

  it('resolves the store\'s mangalsutra ("pote") names to Mangalsutra, elongated', () => {
    // The worst category in the first pilot. It used to resolve to plain
    // Chain, or to nothing at all - which also meant a square frame.
    for (const name of ['ATTACHED CHAIN POTE', 'SHORT NANO POTE', 'DESIGNER POTE', 'SHORT CHAIN POTE']) {
      expect(resolveCategory(name)?.type, name).toBe('Mangalsutra');
      expect(aspectRatioFor(name), name).toBe('3:4');
    }
  });

  it('keeps a chain sold with its pendant elongated, while a bare padak is a square pendant', () => {
    expect(resolveCategory('CHAIN PADAK')?.type).toBe('Chain');
    expect(aspectRatioFor('FANCY CHAIN PADAK')).toBe('3:4');
    expect(resolveCategory('FANCY PADAK')?.type).toBe('Pendant');
    expect(resolveCategory('PENDENT SET')?.type).toBe('Pendant');
  });

  it('resolves EKDANI to a necklace', () => {
    expect(resolveCategory('EKDANI')?.type).toBe('Necklace');
  });

  it('resolves the chain and earring names the owner explained', () => {
    for (const name of ['TENDULKAR', 'NAWABI HOLO', 'INDO-ITALIAN']) expect(resolveCategory(name)?.type, name).toBe('Chain');
    expect(resolveCategory('LONG PBB')?.type).toBe('Mangalsutra');
    expect(resolveCategory('SINGAPORE TOPS')?.type).toBe('J Hoop');
    expect(resolveCategory('KANSAKALI')?.type).toBe('Ear Chain');
    expect(aspectRatioFor('KANSAKALI')).toBe('3:4');
    // Plain "tops" is still a stud.
    expect(resolveCategory('FANCY TOPS')?.type).toBe('Stud');
  });

  it('supplies a gender default only where one is real', () => {
    expect(defaultGenderFor('Mangalsutra')).toBe("women's");
    expect(defaultGenderFor('Chain')).toBe('unisex');
    expect(defaultGenderFor('not a category')).toBeNull();
  });
});

describe('buildOutputFramingBlock', () => {
  it('tells the model not to coil or shorten an elongated piece', () => {
    const block = buildOutputFramingBlock('3:4', 'Mangalsutra');
    expect(block).toContain('3:4');
    expect(block).toMatch(/do NOT coil, shorten, fold/i);
  });

  it('asks for a square for compact pieces', () => {
    expect(buildOutputFramingBlock('1:1', 'Ring')).toContain('SQUARE 1:1');
  });
});

// ---------------------------------------------------------------------------
// Prompt invariants (spec §5a, §13)
// ---------------------------------------------------------------------------

describe('enhance prompt invariants', () => {
  it('forbids fabricating an unseen camera angle', () => {
    expect(DEFAULT_ENHANCE_PROMPT).toMatch(/NEVER invent a camera angle/);
  });

  it('forbids synthesising specular highlights or sparkle', () => {
    expect(DEFAULT_ENHANCE_PROMPT).toMatch(/NEVER re-render the lighting physics/);
  });

  it('keeps the identity lock against adding or removing detail', () => {
    expect(DEFAULT_ENHANCE_PROMPT).toMatch(/Do NOT add any engraving, motif, pattern, gemstone/);
    expect(DEFAULT_ENHANCE_PROMPT).toMatch(/Do NOT remove or simplify/);
  });

  it('no longer hardcodes a square output', () => {
    // The ratio is branched per category now; the prompt must defer to the
    // framing block rather than asserting square.
    expect(DEFAULT_ENHANCE_PROMPT).not.toMatch(/OUTPUT: square \(1:1\)/);
  });
});

describe('audit prompt', () => {
  it('asks for every check the server scores', () => {
    const prompt = buildAuditPrompt({ itemType: 'Ring', purity: '22kt' });
    for (const check of AUDIT_CHECKS) {
      expect(prompt, `audit prompt is missing "${check}"`).toContain(`"${check}"`);
    }
  });

  it('still asks for every check when a verified inventory is included', () => {
    const prompt = buildAuditPrompt({ itemType: 'Jhumka', purity: '22kt' }, '\n\nVERIFIED DETAIL INVENTORY OF IMAGE 1: test');
    expect(prompt).toContain('VERIFIED DETAIL INVENTORY OF IMAGE 1: test');
    for (const check of AUDIT_CHECKS) expect(prompt).toContain(`"${check}"`);
  });

  it('never fails a photo over a hallmark stamp', () => {
    expect(buildAuditPrompt({ itemType: 'Ring', purity: '22kt' })).toMatch(/Ignore hallmark stamps/);
    expect(DEFAULT_ENHANCE_PROMPT).not.toMatch(/blur any hallmark/);
  });

  it('tells the grader what a POS style name actually is', () => {
    const prompt = buildAuditPrompt({ itemType: 'ATTACHED CHAIN POTE', purity: '22kt' });
    expect(prompt).toContain('Mangalsutra (store tag name: "ATTACHED CHAIN POTE")');
    expect(prompt).toMatch(/black beads/i);
  });
});

describe('context block', () => {
  it('leads with the resolved category and carries its notes', () => {
    const block = buildContextBlock({ itemType: 'ATTACHED CHAIN POTE', purity: '22kt' });
    expect(block).toContain('Item Category: Mangalsutra (store tag name: "ATTACHED CHAIN POTE")');
    expect(block).toMatch(/must never be rendered as gold beads/);
  });

  it('passes an unknown style name through, marked as the store\'s own', () => {
    expect(buildContextBlock({ itemType: 'KALKATTA SET' })).toContain('"KALKATTA SET" (the store\'s own style name)');
  });

  it('does not repeat the name when the tag already uses the trade word', () => {
    expect(buildContextBlock({ itemType: 'Ring' })).toContain('Item Category: Ring\n');
  });
});

// ---------------------------------------------------------------------------
// Grounding dedupe cache (spec §5 Stage 0)
// ---------------------------------------------------------------------------

describe('segmentation cache', () => {
  beforeEach(() => clearSegmentationCache());

  it('computes once for the same image and reuses it', async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      return { boxTwoD: [0, 0, 10, 10], polygon: [[0, 0], [1, 1], [2, 2]], label: 'ring' };
    };

    const first = await cachedSegmentation('image-bytes', compute);
    const second = await cachedSegmentation('image-bytes', compute);

    expect(calls).toBe(1);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.result).toEqual(first.result);
  });

  it('computes separately for a different image', async () => {
    let calls = 0;
    const compute = async () => { calls++; return null; };

    await cachedSegmentation('image-a', compute);
    await cachedSegmentation('image-b', compute);

    expect(calls).toBe(2);
    expect(segmentationCacheSize()).toBe(2);
  });

  it('caches a null result too', async () => {
    // An image the model cannot trace will not become traceable within the
    // same quarter hour, and grounding fails open either way.
    let calls = 0;
    const compute = async () => { calls++; return null; };

    await cachedSegmentation('untraceable', compute);
    const second = await cachedSegmentation('untraceable', compute);

    expect(calls).toBe(1);
    expect(second.cacheHit).toBe(true);
    expect(second.result).toBeNull();
  });
});
