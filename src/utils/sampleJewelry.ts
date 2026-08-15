/**
 * Generates a photographic-mockup image for the "Load Sample" demo/testing
 * shortcut, so staff (or a reviewer) can see the flow without a real phone photo.
 * Returns a rasterized PNG data URL, not raw SVG - the Gemini API rejects
 * image/svg+xml outright, so a caller sending this straight to /api/audit-and-enhance
 * would always fail without this conversion.
 */
export async function createJewelryPlaceholderSvg(
  purity: string = '22kt',
  itemType: string = 'necklace',
  customTitle?: string
): Promise<string> {
  const normType = itemType.toLowerCase().trim();
  const is24k = purity.toLowerCase().includes('24');
  const is18k = purity.toLowerCase().includes('18');

  const goldPrimary = is24k ? '#F59E0B' : is18k ? '#EAB308' : '#D97706';
  const goldLight = is24k ? '#FDE047' : is18k ? '#FEF08A' : '#FCD34D';
  const goldDark = is24k ? '#B45309' : is18k ? '#854D0E' : '#92400E';

  let graphicSvg = '';

  if (normType.includes('ring')) {
    graphicSvg = `
      <g transform="translate(300, 280)">
        <ellipse cx="0" cy="35" rx="95" ry="90" fill="none" stroke="url(#goldGrad)" stroke-width="24"/>
        <polygon points="-40,-55 -25,-105 25,-105 40,-55" fill="url(#goldLightGrad)"/>
        <polygon points="0,-115 -35,-80 0,-45 35,-80" fill="#E0F2FE" stroke="#38BDF8" stroke-width="2.5"/>
        <circle cx="0" cy="-80" r="14" fill="#FFFFFF"/>
        <circle cx="-38" cy="-55" r="6" fill="#BAE6FD"/>
        <circle cx="38" cy="-55" r="6" fill="#BAE6FD"/>
      </g>
    `;
  } else if (normType.includes('earring') || normType.includes('jhumka') || normType.includes('bali') || normType.includes('tops')) {
    graphicSvg = `
      <g transform="translate(210, 270)">
        <circle cx="0" cy="-80" r="28" fill="url(#goldLightGrad)"/>
        <circle cx="0" cy="-80" r="12" fill="#DC2626"/>
        <path d="M -55,-15 C -55,-70 55,-70 55,-15 Z" fill="url(#goldGrad)"/>
        <circle cx="-40" cy="20" r="6" fill="#FDE047"/>
        <circle cx="0" cy="28" r="8" fill="#DC2626"/>
        <circle cx="40" cy="20" r="6" fill="#FDE047"/>
      </g>
      <g transform="translate(390, 270)">
        <circle cx="0" cy="-80" r="28" fill="url(#goldLightGrad)"/>
        <circle cx="0" cy="-80" r="12" fill="#DC2626"/>
        <path d="M -55,-15 C -55,-70 55,-70 55,-15 Z" fill="url(#goldGrad)"/>
        <circle cx="-40" cy="20" r="6" fill="#FDE047"/>
        <circle cx="0" cy="28" r="8" fill="#DC2626"/>
        <circle cx="40" cy="20" r="6" fill="#FDE047"/>
      </g>
    `;
  } else if (normType.includes('bangle') || normType.includes('kada') || normType.includes('bracelet') || normType.includes('braclet')) {
    graphicSvg = `
      <g transform="translate(300, 270)">
        <ellipse cx="0" cy="-20" rx="130" ry="65" fill="none" stroke="url(#goldGrad)" stroke-width="26"/>
        <ellipse cx="0" cy="20" rx="130" ry="65" fill="none" stroke="url(#goldLightGrad)" stroke-width="26"/>
        <circle cx="-130" cy="-20" r="8" fill="#DC2626"/>
        <circle cx="130" cy="-20" r="8" fill="#DC2626"/>
        <circle cx="0" cy="85" r="8" fill="#DC2626"/>
      </g>
    `;
  } else {
    graphicSvg = `
      <g transform="translate(300, 240)">
        <path d="M -160,-100 Q 0,110 160,-100" fill="none" stroke="url(#goldDarkGrad)" stroke-width="22"/>
        <path d="M -150,-90 Q 0,95 150,-90" fill="none" stroke="url(#goldLightGrad)" stroke-width="14"/>
        <circle cx="-110" cy="-30" r="12" fill="url(#goldLightGrad)"/>
        <circle cx="-110" cy="-30" r="5" fill="#DC2626"/>
        <circle cx="110" cy="-30" r="12" fill="url(#goldLightGrad)"/>
        <circle cx="110" cy="-30" r="5" fill="#DC2626"/>
        <polygon points="0,55 50,120 0,175 -50,120" fill="url(#goldLightGrad)" stroke="url(#goldDarkGrad)" stroke-width="3"/>
        <circle cx="0" cy="120" r="20" fill="#DC2626"/>
        <circle cx="0" cy="120" r="10" fill="#FEF08A"/>
      </g>
    `;
  }

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <radialGradient id="studioBg" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#26221D"/>
      <stop offset="60%" stop-color="#171411"/>
      <stop offset="100%" stop-color="#0C0A09"/>
    </radialGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${goldLight}"/>
      <stop offset="35%" stop-color="${goldPrimary}"/>
      <stop offset="70%" stop-color="${goldDark}"/>
      <stop offset="100%" stop-color="${goldLight}"/>
    </linearGradient>
    <linearGradient id="goldLightGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FFFBEB"/>
      <stop offset="40%" stop-color="${goldLight}"/>
      <stop offset="100%" stop-color="${goldPrimary}"/>
    </linearGradient>
    <linearGradient id="goldDarkGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${goldPrimary}"/>
      <stop offset="100%" stop-color="#451A03"/>
    </linearGradient>
    <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="600" height="600" fill="url(#studioBg)"/>
  <g transform="translate(300, 48)">
    <rect x="-160" y="-22" width="320" height="44" rx="22" fill="#1C1917" stroke="#D97706" stroke-width="1.5"/>
    <text x="0" y="5" fill="#FDE047" font-size="13" font-family="sans-serif" font-weight="900" text-anchor="middle" letter-spacing="1.5">
      SAMPLE COUNTER PHOTO
    </text>
  </g>
  <ellipse cx="300" cy="470" rx="230" ry="42" fill="#14110E" stroke="#3D3224" stroke-width="2"/>
  <ellipse cx="300" cy="460" rx="200" ry="32" fill="#1F1A14" opacity="0.8"/>
  <ellipse cx="300" cy="455" rx="160" ry="24" fill="#2E261D" opacity="0.6"/>
  <g filter="url(#softGlow)">
    ${graphicSvg}
  </g>
  <rect x="30" y="515" width="540" height="60" rx="14" fill="#14110E" stroke="#292524" stroke-width="1"/>
  <text x="50" y="540" fill="#FDE047" font-size="12" font-family="sans-serif" font-weight="bold" letter-spacing="1">
    RL JEWELS • ${purity.toUpperCase()} ${(customTitle || normType).toUpperCase()}
  </text>
  <text x="50" y="560" fill="#A8A29E" font-size="11" font-family="sans-serif">
    Demo mockup - not a real capture
  </text>
  <rect x="440" y="528" width="115" height="32" rx="8" fill="#DC2626"/>
  <text x="497" y="548" fill="#FFFFFF" font-size="10" font-family="sans-serif" font-weight="bold" text-anchor="middle" letter-spacing="1">
    GUIDE MOCKUP
  </text>
</svg>
  `.trim();

  const svgUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 600;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(svgUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, 600, 600);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(svgUrl);
    img.src = svgUrl;
  });
}
