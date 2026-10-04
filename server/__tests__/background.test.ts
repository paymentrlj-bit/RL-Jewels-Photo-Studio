import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { whitenBackground, measureBorder } from '../imaging/background';

// A gold ring-with-hole and a white "pearl" on a pale blue-grey gradient.
async function necklaceOn(bg: string, opts: { gradient?: boolean; silver?: boolean } = {}): Promise<Buffer> {
  const stroke = opts.silver ? '#b8b8c0' : '#d4a017';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#cfd6dc"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="${opts.gradient ? 'url(#g)' : bg}"/>
    <circle cx="200" cy="250" r="110" fill="none" stroke="${stroke}" stroke-width="40"/>
    <circle cx="200" cy="250" r="20" fill="#f4f4f4" stroke="#d4a017" stroke-width="8"/>
    <rect x="60" y="60" width="40" height="40" fill="${stroke}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function pixel(img: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 3;
  return [data[i], data[i + 1], data[i + 2]];
}

describe('whitenBackground', () => {
  it('turns a grey-blue gradient backdrop into pure white, keeps the gold, and keeps the enclosed pearl', async () => {
    const input = await necklaceOn('#e3e8ee', { gradient: true });
    const before = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(measureBorder(before.data, before.info.width, before.info.height).mean).toBeLessThan(240);

    const { buffer, report } = await whitenBackground(input, 'image/png');
    expect(report.changed).toBe(true);
    expect(await pixel(buffer, 3, 3)).toEqual([255, 255, 255]);
    expect(await pixel(buffer, 390, 490)).toEqual([255, 255, 255]);
    // the hole inside the ring is background too
    expect(await pixel(buffer, 200, 190)).toEqual([255, 255, 255]);
    // gold stays gold
    const gold = await pixel(buffer, 200, 250 - 110);
    expect(gold[0]).toBeGreaterThan(180);
    expect(gold[2]).toBeLessThan(120);
    // the small white stone inside the ring was not reached by the fill
    expect(await pixel(buffer, 200, 250)).toEqual([244, 244, 244]);
  });

  it('leaves an already white photo untouched', async () => {
    const input = await necklaceOn('#ffffff');
    const { buffer, report } = await whitenBackground(input, 'image/png');
    expect(report).toMatchObject({ changed: false, skipped: 'already_white' });
    expect(buffer.equals(input)).toBe(true);
  });

  it('does not touch a silver piece, which cannot be told from the backdrop by colour', async () => {
    const { report } = await whitenBackground(await necklaceOn('#e3e8ee', { silver: true }), 'image/png');
    // Either way it is left alone: the fill cannot tell the piece from the backdrop.
    expect(report.changed).toBe(false);
    expect(['piece_not_coloured', 'no_background_found']).toContain(report.skipped);
  });

  it('survives something that is not an image', async () => {
    const junk = Buffer.from('nope');
    const { buffer, report } = await whitenBackground(junk, 'image/png');
    expect(report.skipped).toBe('unreadable');
    expect(buffer).toBe(junk);
  });

  it('keeps JPEG as JPEG', async () => {
    const input = await sharp(await necklaceOn('#e3e8ee')).jpeg().toBuffer();
    const { mimeType } = await whitenBackground(input, 'image/jpeg');
    expect(mimeType).toBe('image/jpeg');
  });
});
