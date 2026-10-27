// Easy-to-read temporary passwords: no 0/O or 1/l/I to mix up on a phone.
const WORDS = ['gold', 'silver', 'pearl', 'ruby', 'amber', 'lotus', 'moon', 'star', 'river', 'maple', 'coral', 'jasmine'];

export function makeTemporaryPassword(): string {
  const pick = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const word = (i: number) => { const w = WORDS[i]; return w[0].toUpperCase() + w.slice(1); };
  const digits = String(2 + pick(8)) + String(2 + pick(8)) + String(2 + pick(8)) + String(2 + pick(8));
  return `${word(pick(WORDS.length))}-${word(pick(WORDS.length))}-${digits}`;
}
