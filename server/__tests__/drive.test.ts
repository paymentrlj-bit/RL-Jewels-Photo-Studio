// The Drive export folder layout: (Group, only where categories share a
// merchandising department) -> Category -> (Gender, only where it genuinely
// varies) -> Style. Pure and side-effect-free, unlike the rest of drive.ts
// which makes real network calls - this is the part worth testing.
import { describe, it, expect } from 'vitest';
import { driveFolderSegments } from '../integrations/drive';

describe('driveFolderSegments', () => {
  it('a category with no real gender split and no shared department (Mangalsutra) is just Category/Style', () => {
    expect(driveFolderSegments('Vati Mangalsutra', "women's")).toEqual(['Mangalsutra', 'Vati Mangalsutra']);
  });

  it('a category that genuinely spans genders (Ring) gets a gender level, no group', () => {
    expect(driveFolderSegments('Gents Casting Anguthi', "men's")).toEqual(['Ring', "Men's", 'Gents Casting Anguthi']);
    expect(driveFolderSegments('Cocktail Ring', "women's")).toEqual(['Ring', "Women's", 'Cocktail Ring']);
  });

  it('every ear-worn category lands under one "Earrings Category" folder, whatever its own trade name', () => {
    // The real request this guards: a Jhumka, a Chandbali, an Ear Chain and
    // Latkan Tops are different trade categories but the same shopping
    // department - the store wants them found in one place, not four.
    expect(driveFolderSegments('Fancy Zumka 2', "women's")).toEqual(['Earrings Category', 'Jhumka', 'Fancy Zumka 2']);
    expect(driveFolderSegments('Chandrakanta', "women's")).toEqual(['Earrings Category', 'Chandbali', 'Chandrakanta']);
    expect(driveFolderSegments('Kansakali Design', "women's")).toEqual(['Earrings Category', 'Ear Chain', 'Kansakali Design']);
  });

  it('every spelling/synonym of a category resolves to the same canonical category folder name', () => {
    // The real bug this guards: "Chandrakanta" and "Chand Bali" are the same
    // trade category under different names, and used to each get their own
    // top-level folder instead of sharing one.
    expect(driveFolderSegments('Chandrakanta', "women's")[1]).toBe('Chandbali');
    expect(driveFolderSegments('Chand Bali', "women's")[1]).toBe('Chandbali');
  });

  it('a category with a shared department AND a gender split (Bangle) gets both levels, in order', () => {
    expect(driveFolderSegments('Fancy Kangan 2', "women's")).toEqual(['Bangles Category', 'Bangle', "Women's", 'Fancy Kangan 2']);
  });

  it('collapses to "General" when staff typed only the bare category name', () => {
    expect(driveFolderSegments('Ring', "women's")).toEqual(['Ring', "Women's", 'General']);
    expect(driveFolderSegments('mangalsutra', "women's")).toEqual(['Mangalsutra', 'General']);
    expect(driveFolderSegments('Bangle', "women's")).toEqual(['Bangles Category', 'Bangle', "Women's", 'General']);
  });

  it('an unrecognized item type still gets a usable path, not a crash, and no group', () => {
    expect(driveFolderSegments('Something Brand New', "women's")).toEqual(['Uncategorized', 'Something Brand New']);
  });

  it('a blank item type falls back cleanly', () => {
    expect(driveFolderSegments('', "women's")).toEqual(['Uncategorized', 'General']);
  });

  it('trims a very long or slash-containing style name to a safe folder name', () => {
    const long = driveFolderSegments('A'.repeat(200), "women's");
    expect(long[long.length - 1].length).toBeLessThanOrEqual(80);

    const slashy = driveFolderSegments('Chain/Pendant Combo', "women's");
    expect(slashy[slashy.length - 1]).not.toContain('/');
  });
});
