import { describe, it, expect } from 'vitest';
import { shootChecklistFor } from '../catalog/shootChecklist';
import { CATEGORIES } from '../catalog/taxonomy';

const ids = (itemType: string) => shootChecklistFor(itemType).items.map((i) => i.id);
const text = (itemType: string) => shootChecklistFor(itemType).items.map((i) => i.text).join(' | ');

describe('the "check the photo" step', () => {
  it('always asks the basics: whole piece, sharp, plain background', () => {
    for (const t of ['Ring', 'Haar', 'Jhumka', 'something unheard of', '']) {
      expect(ids(t)).toEqual(expect.arrayContaining(['whole', 'sharp', 'clean']));
    }
  });

  it('asks a chain, a bracelet and a haar about both ends and the S hook', () => {
    for (const t of ['Chain', 'Haar', 'FANCY RANI HAR', 'Mangalsutra', 'Necklace']) expect(text(t), t).toMatch(/hook/i);
    expect(text('Bracelet')).toMatch(/S hook/);
    expect(ids('Haar')).toEqual(expect.arrayContaining(['laid', 'ends', 'centre', 'extra']));
  });

  it('asks about the earrings when the piece is a set, and about the pair when it is earrings', () => {
    expect(ids('FANCY HAR SET')).toContain('pieces');
    expect(text('FANCY HAR SET')).toMatch(/both earrings/i);
    expect(ids('Jhumka')).toEqual(expect.arrayContaining(['pair', 'fitting', 'drops']));
    expect(ids('Haar')).not.toContain('pieces');
    // A haar set has the most to check, and still asks about hidden parts.
    expect(ids('FANCY HAR SET')).toContain('extra');
  });

  it('speaks to the shape of a ring, a bangle and a pendant', () => {
    expect(text('Ring')).toMatch(/band/);
    expect(text('Kada')).toMatch(/circle/);
    expect(text('Pendant')).toMatch(/loop/);
  });

  it('is short, has no repeats, and works for every category in the store', () => {
    for (const c of CATEGORIES) {
      const list = shootChecklistFor(c.type).items;
      expect(list.length, c.type).toBeGreaterThanOrEqual(3);
      expect(list.length, c.type).toBeLessThanOrEqual(8);
      expect(new Set(list.map((i) => i.id)).size, c.type).toBe(list.length);
    }
  });

  it('names the piece in its heading', () => {
    expect(shootChecklistFor('rani haar').title).toBe('Haar');
    expect(shootChecklistFor('mystery').title).toBe('mystery');
  });
});
