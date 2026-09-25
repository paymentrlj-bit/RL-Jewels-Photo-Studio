import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import {
  parseDetailRegions,
  parseInventory,
  paddedPixelBox,
  cropDetailRegions,
  buildInventoryBlock,
  buildReferenceImagesBlock,
  buildAuditInventoryBlock,
  hiddenElements,
  buildAngleRequestReason,
  MAX_DETAIL_REGIONS,
  type DetailInventory,
  type InventoryAnalysis,
} from '../ai/inventory';
import { cachedInventory, clearInventoryCache } from '../queue/groundingCache';

const emptyInventory = (): DetailInventory => ({
  elements: [],
  chainStrands: null,
  chainLinkStyle: null,
  surfaceFinish: null,
  naturalOrientation: null,
  proportions: null,
  referenceScale: { present: false, measurements: null },
});

describe('parseDetailRegions', () => {
  it('accepts well-formed boxes', () => {
    const regions = parseDetailRegions([{ box_2d: [100, 200, 300, 400], label: 'bead fringe' }]);
    expect(regions).toEqual([{ box: [100, 200, 300, 400], label: 'bead fringe' }]);
  });

  it('also accepts the list wrapped in an object', () => {
    expect(parseDetailRegions({ regions: [{ box_2d: [0, 0, 100, 100], label: 'x' }] })).toHaveLength(1);
  });

  it('drops inverted, non-numeric and malformed boxes instead of guessing', () => {
    const regions = parseDetailRegions([
      { box_2d: [300, 200, 100, 400], label: 'inverted' },
      { box_2d: [0, 0, 'a', 100], label: 'non-numeric' },
      { box_2d: [0, 0, 100], label: 'too short' },
      { label: 'no box at all' },
    ]);
    expect(regions).toEqual([]);
  });

  it('rejects a box that is really the whole piece - that is not a close-up', () => {
    expect(parseDetailRegions([{ box_2d: [0, 0, 900, 900], label: 'everything' }])).toEqual([]);
  });

  it('clamps coordinates into the 0-1000 frame', () => {
    const [region] = parseDetailRegions([{ box_2d: [-50, 100, 200, 1200], label: 'edge' }]);
    // Clamped width would be 900 x 200 = 18% of the frame - kept.
    expect(region.box).toEqual([0, 100, 200, 1000]);
  });

  it('caps the number of close-ups', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ box_2d: [i * 100, 0, i * 100 + 50, 50], label: `r${i}` }));
    expect(parseDetailRegions(many)).toHaveLength(MAX_DETAIL_REGIONS);
  });

  it('returns nothing for a non-list answer', () => {
    expect(parseDetailRegions(null)).toEqual([]);
    expect(parseDetailRegions('no regions')).toEqual([]);
  });
});

describe('parseInventory', () => {
  it('coerces a numeric string count and defaults an unknown confidence to medium', () => {
    const inv = parseInventory({
      elements: [{ feature: 'bead fringe', count: '7', countConfidence: 'sure', shape: 'round balls', colorMaterial: 'gold', arrangement: 'one row' }],
    });
    expect(inv?.elements[0]).toMatchObject({ count: 7, countConfidence: 'medium' });
  });

  it('keeps a null count for genuinely uncountable features', () => {
    const inv = parseInventory({ elements: [{ feature: 'hammered texture', count: null }] });
    expect(inv?.elements[0].count).toBeNull();
  });

  it('drops elements with no feature name', () => {
    const inv = parseInventory({ elements: [{ count: 3 }, { feature: 'stones', count: 3 }] });
    expect(inv?.elements).toHaveLength(1);
  });

  it('treats a missing or malformed referenceScale as "no scale"', () => {
    expect(parseInventory({})?.referenceScale).toEqual({ present: false, measurements: null });
    expect(parseInventory({ referenceScale: { present: 'yes' } })?.referenceScale.present).toBe(false);
  });

  it('returns null for something that is not an inventory at all', () => {
    expect(parseInventory(null)).toBeNull();
    expect(parseInventory([1, 2])).toBeNull();
  });
});

describe('paddedPixelBox', () => {
  it('pads around the detail and stays inside the image', () => {
    const rect = paddedPixelBox([400, 400, 600, 600], 2000, 1000);
    expect(rect.left).toBeLessThan(800);
    expect(rect.top).toBeLessThan(400);
    expect(rect.left + rect.width).toBeGreaterThan(1200);
    expect(rect.top + rect.height).toBeGreaterThan(600);
  });

  it('clamps at the image edge', () => {
    const rect = paddedPixelBox([0, 0, 100, 100], 1000, 1000);
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(0);
  });
});

describe('cropDetailRegions', () => {
  it('crops the right pixels - [ymin, xmin, ymax, xmax], not x/y swapped', async () => {
    // A wide blue image with one red square. If y and x were swapped anywhere
    // in the maths, the crop would land on plain blue.
    const width = 2000;
    const height = 1000;
    const red = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
    const image = await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .composite([{ input: red, left: 1400, top: 200 }])
      .jpeg()
      .toBuffer();

    // Red square spans x 1400-1600 (700-800 normalized), y 200-400 (200-400).
    const [result] = await cropDetailRegions(image, [{ box: [200, 700, 400, 800], label: 'red square' }]);
    expect(result.crop.mimeType).toBe('image/jpeg');
    expect(result.crop.label).toBe('red square');

    const stats = await sharp(Buffer.from(result.crop.base64, 'base64')).stats();
    const [r, , b] = stats.channels.map((c) => c.mean);
    expect(r).toBeGreaterThan(b);
  });

  it('never upscales a small close-up', async () => {
    const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 10, b: 10 } } }).jpeg().toBuffer();
    const [result] = await cropDetailRegions(image, [{ box: [100, 100, 300, 300], label: 'x' }]);
    const meta = await sharp(Buffer.from(result.crop.base64, 'base64')).metadata();
    expect(meta.width!).toBeLessThan(800);
  });

  it('returns nothing when there are no regions', async () => {
    expect(await cropDetailRegions(Buffer.from(''), [])).toEqual([]);
  });
});

describe('inventory prompt blocks', () => {
  const inventory: DetailInventory = {
    ...emptyInventory(),
    elements: [
      { feature: 'bead fringe along the base of each jhumka', count: 7, countConfidence: 'high', shape: 'round balls', colorMaterial: 'plain gold', arrangement: 'single row' },
      { feature: 'black beads in gold cages', count: 12, countConfidence: 'low', shape: 'round', colorMaterial: 'black glass', arrangement: 'two hidden by the tag' },
    ],
    chainStrands: 2,
    chainLinkStyle: 'flat hand-made links',
    proportions: 'each drop is 2x the pendant height',
    referenceScale: { present: true, measurements: 'total length 18 cm' },
  };

  it('states every count as a fact, and flags partly hidden groups', () => {
    const block = buildInventoryBlock(inventory);
    expect(block).toContain('VERIFIED DETAIL INVENTORY');
    expect(block).toContain('exactly 7');
    expect(block).toContain('black glass');
    expect(block).toMatch(/partly hidden/);
    expect(block).toContain('2 strand(s), flat hand-made links');
    expect(block).toContain('total length 18 cm');
  });

  it('omits the block entirely when there is nothing to say', () => {
    expect(buildInventoryBlock(emptyInventory())).toBe('');
  });

  it('numbers enhance close-ups from image 2 - the photo itself is image 1', () => {
    const block = buildReferenceImagesBlock([
      { base64: '', mimeType: 'image/jpeg', label: 'fringe', kind: 'closeup' as const },
      { base64: '', mimeType: 'image/jpeg', label: 'motif', kind: 'closeup' as const },
    ]);
    expect(block).toContain('image 2 is a full-resolution close-up cropped from image 1: "fringe"');
    expect(block).toContain('image 3 is a full-resolution close-up cropped from image 1: "motif"');
    expect(block).toMatch(/exactly once/);
    expect(buildReferenceImagesBlock([])).toBe('');
  });

  it('numbers audit close-ups from IMAGE 3 - original and enhanced come first', () => {
    const block = buildAuditInventoryBlock(inventory, [{ base64: '', mimeType: 'image/jpeg', label: 'fringe', kind: 'closeup' as const }]);
    expect(block).toContain('IMAGE 3 is a full-resolution close-up cropped from IMAGE 1: "fringe"');
    expect(block).toMatch(/black beads must still be black/);
  });
});

describe('inventory cache', () => {
  beforeEach(() => clearInventoryCache());

  const analysis: InventoryAnalysis = { regions: [], inventory: emptyInventory() };

  it('pays for the inventory once per photo', async () => {
    let calls = 0;
    const compute = async () => { calls++; return analysis; };
    await cachedInventory('photo', compute);
    const second = await cachedInventory('photo', compute);
    expect(calls).toBe(1);
    expect(second.cacheHit).toBe(true);
  });

  it('does not remember a failure, so the next attempt tries again', async () => {
    let calls = 0;
    await expect(cachedInventory('photo', async () => { calls++; throw new Error('timeout'); })).rejects.toThrow('timeout');
    const retry = await cachedInventory('photo', async () => { calls++; return analysis; });
    expect(calls).toBe(2);
    expect(retry.cacheHit).toBe(false);
  });
});

describe('other-angle photos', () => {
  it('tells the image model an angle photo is a different view, not a close-up', () => {
    const block = buildReferenceImagesBlock([
      { base64: '', mimeType: 'image/jpeg', label: 'another angle', kind: 'angle' },
      { base64: '', mimeType: 'image/jpeg', label: 'fringe', kind: 'closeup' },
    ]);
    expect(block).toContain('image 2 is the same piece photographed from another angle');
    expect(block).toContain('image 3 is a full-resolution close-up');
    expect(block).toMatch(/exactly once/);
  });
});

describe('asking for another angle', () => {
  const element = (overrides: Partial<DetailInventory['elements'][number]>) => ({
    feature: 'bead fringe', count: 7, countConfidence: 'high' as const, shape: '', colorMaterial: '', arrangement: '', ...overrides,
  });

  it('flags only countable elements the inspector could not fully see', () => {
    const inv = {
      ...emptyInventory(),
      elements: [
        element({ feature: 'visible fringe' }),
        element({ feature: 'hidden fringe', countConfidence: 'low' }),
        element({ feature: 'hidden texture', countConfidence: 'low', count: null }),
      ],
    };
    expect(hiddenElements(inv).map((e) => e.feature)).toEqual(['hidden fringe']);
  });

  it('says what is hidden and gives a concrete action, not just "another angle"', () => {
    const reason = buildAngleRequestReason([
      element({ feature: 'halo diamonds', countConfidence: 'low', arrangement: 'two hidden behind the thumb' }),
    ]);
    expect(reason).toContain('halo diamonds:');
    expect(reason).toMatch(/without a finger over it/);
    expect(reason).toMatch(/Process anyway/);
  });

  it('matches the obstruction to a specific instruction', () => {
    const act = (arrangement: string) =>
      buildAngleRequestReason([element({ feature: 'x', countConfidence: 'low', arrangement })]);
    expect(act('back half hidden behind the price tag')).toMatch(/Move the price tag/);
    expect(act('hidden behind the other earring')).toMatch(/on its own/);
    expect(act('back of the pendant not visible')).toMatch(/Turn the piece over/);
    expect(act('right edge is cut off, out of frame')).toMatch(/Move the camera back/);
    expect(act('a shadow falls across it')).toMatch(/Turn the piece so this part faces the camera/);
  });

  it('covers up to three hidden parts', () => {
    const reason = buildAngleRequestReason([
      element({ feature: 'a', countConfidence: 'low', arrangement: 'behind the tag' }),
      element({ feature: 'b', countConfidence: 'low', arrangement: 'behind a finger' }),
      // out of frame is the one case that drops the feature name (see the
      // dedup test below) - back of the pendant keeps a distinct third line.
      element({ feature: 'c', countConfidence: 'low', arrangement: 'back of the pendant not visible' }),
      element({ feature: 'd', countConfidence: 'low', arrangement: 'behind the tag' }),
    ]);
    expect(reason).toContain('a:');
    expect(reason).toContain('b:');
    expect(reason).toContain('c:');
    expect(reason).not.toContain('d:');
  });

  it('says "move the camera back" once, not once per feature that was out of frame', () => {
    // The real bug this guards: two different intricate details both flagged
    // as out of frame produced "small beaded spheres...: Move the camera
    // back... flat strip segments...: Move the camera back..." - the same
    // instruction, twice, each time behind a feature name staff didn't need.
    const reason = buildAngleRequestReason([
      element({ feature: 'small beaded spheres between floral motifs', countConfidence: 'low', arrangement: 'right edge cut off, out of frame' }),
      element({ feature: 'flat strip segments with vertical rows', countConfidence: 'low', arrangement: 'bottom is out of frame' }),
    ]);
    const occurrences = reason.match(/Move the camera back/g) || [];
    expect(occurrences).toHaveLength(1);
    expect(reason).not.toContain('small beaded spheres');
    expect(reason).not.toContain('flat strip segments');
  });
});
