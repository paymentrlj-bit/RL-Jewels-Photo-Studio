// Turns whatever a tag's QR/barcode holds into the CPC the form wants.
//
// The store's CPCs look like 1516L350 (ProductId, "L", LotNo - see
// CPC_MASTER_DATA.md). A code may carry just that, or wrap it in a URL or
// other text; either way the CPC is the part worth keeping. Shared by the
// scanner (browser) and the tests.

const CPC_PATTERN = /(?:^|[^0-9A-Z])(\d{1,6})\s*[-/]?\s*L\s*[-/]?\s*(\d{1,7})(?![0-9])/i;

export interface ScannedCode {
  cpc: string;
  /** True when a CPC-shaped value was found; false means the raw text was kept as-is. */
  matched: boolean;
}

export function extractCpc(raw: string): ScannedCode {
  const text = String(raw ?? '').trim();
  const match = CPC_PATTERN.exec(text);
  if (match) return { cpc: `${match[1]}L${match[2]}`, matched: true };
  return { cpc: text.slice(0, 64), matched: false };
}
