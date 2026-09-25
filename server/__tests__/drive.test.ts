// The Drive export folder layout: Category -> (Gender, only where it
// genuinely varies) -> Style. Pure and side-effect-free, unlike the rest of
// drive.ts which makes real network calls - this is the part worth testing.
import { describe, it, expect } from 'vitest';
import { driveFolderSegments } from '../integrations/drive';

describe('driveFolderSegments', () => {
  it('a category with no real gender split (Mangalsutra) skips the gender level', () => {
    expect(driveFolderSegments('Vati Mangalsutra', "women's")).toEqual(['Mangalsutra', 'Vati Mangalsutra']);
  });

  it('a category that genuinely spans genders (Ring) gets a gender level', () => {
    expect(driveFolderSegments('Gents Casting Anguthi', "men's")).toEqual(['Ring', "Men's", 'Gents Casting Anguthi']);
    expect(driveFolderSegments('Cocktail Ring', "women's")).toEqual(['Ring', "Women's", 'Cocktail Ring']);
  });

  it('every spelling/synonym of a category resolves to the same canonical folder name', () => {
    // The real bug this guards: "Chandrakanta" and "Chand Bali" are the same
    // trade category under different names, and used to each get their own
    // top-level folder instead of sharing one.
    expect(driveFolderSegments('Chandrakanta', "women's")[0]).toBe('Chandbali');
    expect(driveFolderSegments('Chand Bali', "women's")[0]).toBe('Chandbali');
  });

  it('collapses to "General" when staff typed only the bare category name', () => {
    expect(driveFolderSegments('Ring', "women's")).toEqual(['Ring', "Women's", 'General']);
    expect(driveFolderSegments('mangalsutra', "women's")).toEqual(['Mangalsutra', 'General']);
  });

  it('an unrecognized item type still gets a usable path, not a crash', () => {
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
