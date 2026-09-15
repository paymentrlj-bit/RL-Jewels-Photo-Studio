import { describe, it, expect } from 'vitest';
import {
  deriveProductIdFromCpc,
  normalizeGoldPurity,
  guessGenderFromStyleName,
} from '../integrations/cpcMaster';

// The store's POS builds every CPC as <ProductId>L<LotNo>. Only the ProductId
// is ever used for lookup - see CPC_MASTER_DATA.md for why the LotNo carries
// no information. These tests pin that contract down, because getting it
// wrong silently mis-identifies products rather than failing loudly.
describe('deriveProductIdFromCpc', () => {
  it('extracts the ProductId from a well-formed CPC', () => {
    expect(deriveProductIdFromCpc('1265L1051')).toBe('1265');
  });

  it('accepts a lowercase separator', () => {
    expect(deriveProductIdFromCpc('1265l1051')).toBe('1265');
  });

  it('tolerates surrounding whitespace from a scanner or a paste', () => {
    expect(deriveProductIdFromCpc('  1265L1051  ')).toBe('1265');
  });

  it('works for a ProductId that is not in the master data at all', () => {
    // A brand-new product, or data that is simply out of date, must still
    // parse - the derivation is a string rule, not a lookup.
    expect(deriveProductIdFromCpc('999999L1')).toBe('999999');
  });

  it('rejects anything that is not <digits>L<digits>', () => {
    expect(deriveProductIdFromCpc('RLJ-RN-8821')).toBeNull();
    expect(deriveProductIdFromCpc('1265')).toBeNull();
    expect(deriveProductIdFromCpc('L1051')).toBeNull();
    expect(deriveProductIdFromCpc('1265L')).toBeNull();
    expect(deriveProductIdFromCpc('12A65L1051')).toBeNull();
    expect(deriveProductIdFromCpc('')).toBeNull();
  });

  it('rejects a CPC with more than one separator', () => {
    expect(deriveProductIdFromCpc('1265L10L51')).toBeNull();
  });
});

describe('normalizeGoldPurity', () => {
  it('maps the POS purity strings onto the app types', () => {
    expect(normalizeGoldPurity('22 Ct')).toBe('22kt');
    expect(normalizeGoldPurity('18 Ct/85')).toBe('18kt');
    expect(normalizeGoldPurity('24Ct')).toBe('24kt');
  });

  it('returns null for a purity the app has no type for', () => {
    // Silver at 92.50 is real data in the master file; it must not be
    // silently coerced into a gold purity.
    expect(normalizeGoldPurity('92.50')).toBeNull();
    expect(normalizeGoldPurity('14 Ct')).toBeNull();
    expect(normalizeGoldPurity('')).toBeNull();
  });
});

describe('guessGenderFromStyleName', () => {
  it('reads the gendered style names the POS actually uses', () => {
    expect(guessGenderFromStyleName('ANGUTHI GENTS')).toBe("men's");
    expect(guessGenderFromStyleName('ANGUTHI LADIES')).toBe("women's");
    expect(guessGenderFromStyleName('BACCHA KADA')).toBe("kids'");
  });

  it('handles the LADIS spelling variant present in the data', () => {
    expect(guessGenderFromStyleName('BANGLE LADIS')).toBe("women's");
  });

  it('returns null for a genuinely gender-neutral style', () => {
    // Most chains and bangles are neutral; returning null lets the caller's
    // default stand rather than asserting a guess.
    expect(guessGenderFromStyleName('CHAIN')).toBeNull();
    expect(guessGenderFromStyleName('BANGLE')).toBeNull();
  });

  it('does not match a gender word embedded in a longer word', () => {
    expect(guessGenderFromStyleName('REGENTSTYLE')).toBeNull();
  });
});
