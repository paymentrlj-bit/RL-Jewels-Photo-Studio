import { PhotoSlotType } from '../types';

/**
 * Generates photographic-grade SVG data URLs for counter staff guidance and sample mockups.
 * Tailors both the jewelry item geometry AND the specific camera angle/view.
 */
export function createJewelryPlaceholderSvg(
  slotType: PhotoSlotType | string,
  purity: string = '22kt',
  itemType: string = 'necklace',
  customTitle?: string
): string {
  const normType = itemType.toLowerCase().trim();
  const is24k = purity.toLowerCase().includes('24');
  const is18k = purity.toLowerCase().includes('18');
  
  // Gold gradient color stops based on purity
  const goldPrimary = is24k ? '#F59E0B' : is18k ? '#EAB308' : '#D97706';
  const goldLight = is24k ? '#FDE047' : is18k ? '#FEF08A' : '#FCD34D';
  const goldDark = is24k ? '#B45309' : is18k ? '#854D0E' : '#92400E';

  // Determine angle archetype
  let angleBadge = 'STUDIO HERO SHOT';
  let angleDesc = 'Centering & Full Outline';

  if (slotType === 'angle_1' || slotType.includes('front')) {
    angleBadge = '0° EYE-LEVEL FRONT VIEW';
    angleDesc = 'Head-on symmetry & centerpiece';
  } else if (slotType === 'angle_2' || slotType.includes('45')) {
    angleBadge = '45° ANGLE PERSPECTIVE';
    angleDesc = '3D Depth, Prong Height & Relief';
  } else if (slotType === 'angle_3' || slotType.includes('side') || slotType.includes('clasp')) {
    angleBadge = 'SIDE / CLASP / BACK VIEW';
    angleDesc = 'Lock mechanism, screw & back-work';
  } else if (slotType === 'macro_hallmark' || slotType.includes('macro')) {
    angleBadge = 'MACRO BIS 916 HALLMARK';
    angleDesc = '5cm Extreme Close-up laser stamp';
  }

  // Generate SVG Graphic paths according to Item Type and Angle
  let graphicSvg = '';

  // 1. RING MOCKUPS
  if (normType.includes('ring')) {
    if (slotType === 'macro_hallmark') {
      graphicSvg = `
        <!-- Macro Hallmark View inside Ring Shank -->
        <path d="M 120,420 C 180,180 420,180 480,420" fill="none" stroke="url(#goldGrad)" stroke-width="64" stroke-linecap="round"/>
        <path d="M 140,420 C 190,210 410,210 460,420" fill="none" stroke="url(#goldLightGrad)" stroke-width="40" stroke-linecap="round"/>
        
        <!-- Laser Hallmark Inscription Box -->
        <g transform="translate(300, 230)">
          <rect x="-130" y="-35" width="260" height="70" rx="8" fill="#1C1917" stroke="#78350F" stroke-width="2" opacity="0.9"/>
          <!-- BIS Triangle Logo -->
          <polygon points="-100,15 -80,-15 -60,15" fill="#FBBF24"/>
          <!-- 916 Stamp -->
          <text x="-40" y="8" fill="#FDE047" font-size="22" font-family="monospace" font-weight="900" letter-spacing="2">916</text>
          <!-- RLJ Logo Stamp -->
          <text x="25" y="8" fill="#FBBF24" font-size="16" font-family="sans-serif" font-weight="bold">RLJ</text>
          <!-- HUID Code -->
          <text x="65" y="8" fill="#E2E8F0" font-size="12" font-family="monospace">H94K2</text>
        </g>
        <text x="300" y="320" fill="#FDE047" font-size="13" font-family="sans-serif" font-weight="bold" text-anchor="middle">
          [BIS TRIANGLE • 916 PURITY • RLJ JEWELS • HUID CERTIFIED]
        </text>
      `;
    } else if (slotType === 'angle_2') {
      // 45-degree angled perspective of ring
      graphicSvg = `
        <!-- 45-Degree 3D Angled Ring -->
        <g transform="translate(300, 290) rotate(-22)">
          <!-- Angled Shank ellipse with perspective thickness -->
          <ellipse cx="0" cy="40" rx="110" ry="60" fill="none" stroke="url(#goldDarkGrad)" stroke-width="32"/>
          <ellipse cx="0" cy="30" rx="110" ry="60" fill="none" stroke="url(#goldGrad)" stroke-width="24"/>
          
          <!-- Raised Crown / Prongs Elevation -->
          <path d="M -45,-30 L -30,-85 L 30,-85 L 45,-30 Z" fill="url(#goldLightGrad)" stroke="url(#goldDarkGrad)" stroke-width="3"/>
          <polygon points="-25,-85 0,-125 25,-85" fill="url(#goldGrad)"/>
          
          <!-- Solitaire Diamond 3D Facet -->
          <polygon points="0,-128 -38,-92 0,-56 38,-92" fill="#E0F2FE" stroke="#38BDF8" stroke-width="2" opacity="0.95"/>
          <polygon points="0,-128 0,-56 38,-92" fill="#BAE6FD" opacity="0.8"/>
          <circle cx="0" cy="-92" r="10" fill="#FFFFFF"/>
          
          <!-- Side Filigree Cathedral -->
          <path d="M -85,10 C -60,-40 -40,-60 -25,-85" fill="none" stroke="url(#goldLightGrad)" stroke-width="6"/>
          <path d="M 85,10 C 60,-40 40,-60 25,-85" fill="none" stroke="url(#goldLightGrad)" stroke-width="6"/>
        </g>
      `;
    } else if (slotType === 'angle_3') {
      // Side / Back Shank of ring
      graphicSvg = `
        <!-- Side Profile & Back Shank -->
        <g transform="translate(300, 290)">
          <!-- Side view profile -->
          <circle cx="0" cy="0" r="105" fill="none" stroke="url(#goldGrad)" stroke-width="28"/>
          <!-- Hollow gallery underside -->
          <path d="M -50,-90 C -20,-70 20,-70 50,-90" fill="none" stroke="url(#goldLightGrad)" stroke-width="8"/>
          <rect x="-35" y="-120" width="70" height="30" rx="6" fill="url(#goldDarkGrad)"/>
          <!-- Setting Bridge view -->
          <circle cx="0" cy="-105" r="12" fill="#E0F2FE" stroke="#0284C7" stroke-width="2"/>
        </g>
      `;
    } else {
      // Hero & Front View
      graphicSvg = `
        <!-- Head-on Frontal Solitaire Ring -->
        <g transform="translate(300, 280)">
          <ellipse cx="0" cy="35" rx="95" ry="90" fill="none" stroke="url(#goldGrad)" stroke-width="24"/>
          <!-- Solitaire Center Gem & Lotus Petals -->
          <polygon points="-40,-55 -25,-105 25,-105 40,-55" fill="url(#goldLightGrad)"/>
          <polygon points="0,-115 -35,-80 0,-45 35,-80" fill="#E0F2FE" stroke="#38BDF8" stroke-width="2.5"/>
          <circle cx="0" cy="-80" r="14" fill="#FFFFFF"/>
          <!-- Surrounding Accent Diamonds -->
          <circle cx="-38" cy="-55" r="6" fill="#BAE6FD"/>
          <circle cx="38" cy="-55" r="6" fill="#BAE6FD"/>
          <circle cx="-55" cy="-35" r="5" fill="#BAE6FD"/>
          <circle cx="55" cy="-35" r="5" fill="#BAE6FD"/>
        </g>
      `;
    }
  }

  // 2. EARRINGS MOCKUPS
  else if (normType.includes('earring') || normType.includes('jhumka')) {
    if (slotType === 'macro_hallmark') {
      graphicSvg = `
        <!-- Macro Earring Post / Hallmark -->
        <g transform="translate(300, 260)">
          <line x1="0" y1="-80" x2="0" y2="80" stroke="url(#goldGrad)" stroke-width="36" stroke-linecap="round"/>
          <rect x="-70" y="-30" width="140" height="60" rx="8" fill="#1C1917" stroke="#B45309" stroke-width="2"/>
          <polygon points="-50,10 -35,-12 -20,10" fill="#FBBF24"/>
          <text x="-5" y="5" fill="#FDE047" font-size="18" font-family="monospace" font-weight="bold">916</text>
          <text x="35" y="5" fill="#FFFFFF" font-size="12" font-family="sans-serif">RLJ</text>
        </g>
      `;
    } else if (slotType === 'angle_2') {
      // 45-degree perspective of dangling jhumki
      graphicSvg = `
        <!-- 45-Degree Angled Jhumki Pair -->
        <g transform="translate(230, 270) rotate(-15)">
          <circle cx="0" cy="-70" r="26" fill="url(#goldLightGrad)" stroke="url(#goldDarkGrad)" stroke-width="3"/>
          <circle cx="0" cy="-70" r="10" fill="#B91C1C"/>
          <!-- Dome with 3D elliptical angle -->
          <path d="M -50,-10 C -50,-60 50,-60 50,-10 Z" fill="url(#goldGrad)"/>
          <ellipse cx="0" cy="-10" rx="50" ry="18" fill="url(#goldLightGrad)" stroke="url(#goldDarkGrad)" stroke-width="2"/>
          <!-- Hanging pearl drops -->
          <circle cx="-35" cy="25" r="7" fill="#FEF3C7"/>
          <circle cx="-15" cy="30" r="7" fill="#FEF3C7"/>
          <circle cx="15" cy="30" r="7" fill="#FEF3C7"/>
          <circle cx="35" cy="25" r="7" fill="#FEF3C7"/>
        </g>
        <g transform="translate(370, 270) rotate(15)">
          <circle cx="0" cy="-70" r="26" fill="url(#goldLightGrad)" stroke="url(#goldDarkGrad)" stroke-width="3"/>
          <circle cx="0" cy="-70" r="10" fill="#B91C1C"/>
          <path d="M -50,-10 C -50,-60 50,-60 50,-10 Z" fill="url(#goldGrad)"/>
          <ellipse cx="0" cy="-10" rx="50" ry="18" fill="url(#goldLightGrad)" stroke="url(#goldDarkGrad)" stroke-width="2"/>
          <circle cx="-35" cy="25" r="7" fill="#FEF3C7"/>
          <circle cx="-15" cy="30" r="7" fill="#FEF3C7"/>
          <circle cx="15" cy="30" r="7" fill="#FEF3C7"/>
          <circle cx="35" cy="25" r="7" fill="#FEF3C7"/>
        </g>
      `;
    } else if (slotType === 'angle_3') {
      // Rear screw mechanism
      graphicSvg = `
        <!-- Rear Bombay Screw & Post -->
        <g transform="translate(300, 280)">
          <circle cx="0" cy="-40" r="38" fill="url(#goldDarkGrad)"/>
          <circle cx="0" cy="-40" r="18" fill="#1C1917" stroke="url(#goldLightGrad)" stroke-width="3"/>
          <line x1="0" y1="-40" x2="0" y2="60" stroke="url(#goldGrad)" stroke-width="14" stroke-linecap="round"/>
          <polygon points="-25,40 0,65 25,40" fill="url(#goldLightGrad)"/>
        </g>
      `;
    } else {
      // Hero / Front View Jhumki Pair
      graphicSvg = `
        <!-- Front Head-on Earring Pair -->
        <g transform="translate(210, 270)">
          <circle cx="0" cy="-80" r="28" fill="url(#goldLightGrad)"/>
          <circle cx="0" cy="-80" r="12" fill="#DC2626"/>
          <path d="M -55,-15 C -55,-70 55,-70 55,-15 Z" fill="url(#goldGrad)"/>
          <line x1="-55" y1="-15" x2="55" y2="-15" stroke="url(#goldDarkGrad)" stroke-width="6"/>
          <!-- Droplets -->
          <circle cx="-40" cy="20" r="6" fill="#FDE047"/>
          <circle cx="-20" cy="26" r="6" fill="#FDE047"/>
          <circle cx="0" cy="28" r="8" fill="#DC2626"/>
          <circle cx="20" cy="26" r="6" fill="#FDE047"/>
          <circle cx="40" cy="20" r="6" fill="#FDE047"/>
        </g>
        <g transform="translate(390, 270)">
          <circle cx="0" cy="-80" r="28" fill="url(#goldLightGrad)"/>
          <circle cx="0" cy="-80" r="12" fill="#DC2626"/>
          <path d="M -55,-15 C -55,-70 55,-70 55,-15 Z" fill="url(#goldGrad)"/>
          <line x1="-55" y1="-15" x2="55" y2="-15" stroke="url(#goldDarkGrad)" stroke-width="6"/>
          <circle cx="-40" cy="20" r="6" fill="#FDE047"/>
          <circle cx="-20" cy="26" r="6" fill="#FDE047"/>
          <circle cx="0" cy="28" r="8" fill="#DC2626"/>
          <circle cx="20" cy="26" r="6" fill="#FDE047"/>
          <circle cx="40" cy="20" r="6" fill="#FDE047"/>
        </g>
      `;
    }
  }

  // 3. BANGLE / KADA MOCKUPS
  else if (normType.includes('bangle') || normType.includes('kada') || normType.includes('bracelet')) {
    if (slotType === 'macro_hallmark') {
      graphicSvg = `
        <!-- Macro Bangle Inner Rim Stamp -->
        <g transform="translate(300, 270)">
          <path d="M -180,60 Q 0,-30 180,60" fill="none" stroke="url(#goldGrad)" stroke-width="50" stroke-linecap="round"/>
          <rect x="-100" y="-15" width="200" height="50" rx="6" fill="#1C1917" stroke="#D97706" stroke-width="2"/>
          <polygon points="-75,20 -60,0 -45,20" fill="#FBBF24"/>
          <text x="-35" y="15" fill="#FDE047" font-size="20" font-family="monospace" font-weight="bold">916</text>
          <text x="15" y="15" fill="#FFFFFF" font-size="14" font-family="sans-serif">RLJ</text>
        </g>
      `;
    } else if (slotType === 'angle_2') {
      // 45-degree angle of bangle pair
      graphicSvg = `
        <!-- 45-Degree Angled Bangle Pair -->
        <g transform="translate(300, 270) rotate(-25)">
          <ellipse cx="-20" cy="-20" rx="140" ry="70" fill="none" stroke="url(#goldDarkGrad)" stroke-width="32"/>
          <ellipse cx="-20" cy="-20" rx="140" ry="70" fill="none" stroke="url(#goldLightGrad)" stroke-width="22"/>
          <ellipse cx="20" cy="20" rx="140" ry="70" fill="none" stroke="url(#goldDarkGrad)" stroke-width="32"/>
          <ellipse cx="20" cy="20" rx="140" ry="70" fill="none" stroke="url(#goldGrad)" stroke-width="22"/>
          <!-- Ruby & Emerald Floral Cabochons -->
          <circle cx="-140" cy="-20" r="10" fill="#DC2626"/>
          <circle cx="100" cy="-20" r="10" fill="#15803D"/>
          <circle cx="-100" cy="20" r="10" fill="#DC2626"/>
          <circle cx="140" cy="20" r="10" fill="#15803D"/>
        </g>
      `;
    } else if (slotType === 'angle_3') {
      // Bangle Clasp / Screw Lock
      graphicSvg = `
        <!-- Bangle Hinge & Safety Screw Pin -->
        <g transform="translate(300, 280)">
          <path d="M -120,-60 L -120,60" stroke="url(#goldDarkGrad)" stroke-width="34" stroke-linecap="round"/>
          <rect x="-140" y="-20" width="40" height="40" rx="4" fill="url(#goldLightGrad)"/>
          <circle cx="-120" cy="0" r="6" fill="#1C1917"/>
          <path d="M -120,0 C -50,50 50,50 120,0" fill="none" stroke="url(#goldGrad)" stroke-width="26"/>
        </g>
      `;
    } else {
      // Frontal Bangle Stack
      graphicSvg = `
        <!-- Front View Bangles -->
        <g transform="translate(300, 270)">
          <ellipse cx="0" cy="-20" rx="130" ry="65" fill="none" stroke="url(#goldGrad)" stroke-width="26"/>
          <ellipse cx="0" cy="20" rx="130" ry="65" fill="none" stroke="url(#goldLightGrad)" stroke-width="26"/>
          <circle cx="-130" cy="-20" r="8" fill="#DC2626"/>
          <circle cx="130" cy="-20" r="8" fill="#DC2626"/>
          <circle cx="-130" cy="20" r="8" fill="#16A34A"/>
          <circle cx="130" cy="20" r="8" fill="#16A34A"/>
          <circle cx="0" cy="85" r="8" fill="#DC2626"/>
        </g>
      `;
    }
  }

  // 4. NECKLACE / HARAM / MANGALSUTRA / PENDANT (Default fine jewelry)
  else {
    if (slotType === 'macro_hallmark') {
      graphicSvg = `
        <!-- Macro Hallmark S-Hook / Clasp Plate -->
        <g transform="translate(300, 260)">
          <!-- S-Hook Clasp Geometry -->
          <path d="M -60,40 C -80,0 -40,-60 0,-40 C 40,-20 80,-80 60,-40 C 40,0 -20,60 -60,40" fill="none" stroke="url(#goldGrad)" stroke-width="32" stroke-linecap="round"/>
          <rect x="-90" y="-15" width="180" height="50" rx="6" fill="#1C1917" stroke="#D97706" stroke-width="2"/>
          <polygon points="-70,20 -55,0 -40,20" fill="#FBBF24"/>
          <text x="-30" y="15" fill="#FDE047" font-size="20" font-family="monospace" font-weight="bold">916</text>
          <text x="18" y="15" fill="#FFFFFF" font-size="14" font-family="sans-serif">RLJ</text>
        </g>
      `;
    } else if (slotType === 'angle_2') {
      // 45-degree angle of necklace showing layered relief
      graphicSvg = `
        <!-- 45-Degree Angled Necklace & Layered Kundan Settings -->
        <g transform="translate(300, 250) rotate(-15)">
          <path d="M -160,-90 Q -20,110 140,-50" fill="none" stroke="url(#goldDarkGrad)" stroke-width="24"/>
          <path d="M -150,-80 Q -20,100 130,-40" fill="none" stroke="url(#goldLightGrad)" stroke-width="16"/>
          <!-- Royal Center Pendant in 3D perspective -->
          <polygon points="-20,80 30,140 -10,190 -60,130" fill="url(#goldGrad)" stroke="url(#goldDarkGrad)" stroke-width="3"/>
          <circle cx="-15" cy="135" r="16" fill="#DC2626"/>
          <circle cx="-10" cy="205" r="10" fill="#FEF08A"/>
        </g>
      `;
    } else if (slotType === 'angle_3') {
      // Dori back rope & S-hook clasp
      graphicSvg = `
        <!-- Adjustable Golden Dori & Back S-Hook -->
        <g transform="translate(300, 260)">
          <path d="M -120,-80 Q 0,-30 120,-80" fill="none" stroke="#D97706" stroke-width="8" stroke-dasharray="6,4"/>
          <circle cx="0" cy="-55" r="12" fill="url(#goldLightGrad)"/>
          <path d="M -30,-40 C -40,-10 0,20 20,-10" fill="none" stroke="url(#goldGrad)" stroke-width="14" stroke-linecap="round"/>
        </g>
      `;
    } else {
      // Majestic Frontal Kundan Haram Necklace
      graphicSvg = `
        <!-- Royal Frontal Necklace on Display Bust -->
        <g transform="translate(300, 240)">
          <!-- Multi-tier gold chain arch -->
          <path d="M -160,-100 Q 0,110 160,-100" fill="none" stroke="url(#goldDarkGrad)" stroke-width="22"/>
          <path d="M -150,-90 Q 0,95 150,-90" fill="none" stroke="url(#goldLightGrad)" stroke-width="14"/>
          <path d="M -120,-70 Q 0,70 120,-70" fill="none" stroke="url(#goldGrad)" stroke-width="8" stroke-dasharray="6,4"/>
          
          <!-- Floral Motif Accents along the rim -->
          <circle cx="-110" cy="-30" r="12" fill="url(#goldLightGrad)"/>
          <circle cx="-110" cy="-30" r="5" fill="#DC2626"/>
          <circle cx="110" cy="-30" r="12" fill="url(#goldLightGrad)"/>
          <circle cx="110" cy="-30" r="5" fill="#DC2626"/>
          <circle cx="-60" cy="25" r="14" fill="url(#goldLightGrad)"/>
          <circle cx="-60" cy="25" r="6" fill="#16A34A"/>
          <circle cx="60" cy="25" r="14" fill="url(#goldLightGrad)"/>
          <circle cx="60" cy="25" r="6" fill="#16A34A"/>
          
          <!-- Grand Center Peacock/Lotus Pendant -->
          <polygon points="0,55 50,120 0,175 -50,120" fill="url(#goldLightGrad)" stroke="url(#goldDarkGrad)" stroke-width="3"/>
          <circle cx="0" cy="120" r="20" fill="#DC2626"/>
          <circle cx="0" cy="120" r="10" fill="#FEF08A"/>
          <!-- Hanging Pearl Cluster -->
          <circle cx="-20" cy="180" r="7" fill="#FEF3C7"/>
          <circle cx="0" cy="195" r="9" fill="#FEF3C7"/>
          <circle cx="20" cy="180" r="7" fill="#FEF3C7"/>
        </g>
      `;
    }
  }

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <!-- Studio Ambient Background Gradient -->
    <radialGradient id="studioBg" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#26221D"/>
      <stop offset="60%" stop-color="#171411"/>
      <stop offset="100%" stop-color="#0C0A09"/>
    </radialGradient>

    <!-- Gold Material Gradients -->
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

    <!-- Studio Soft Glow -->
    <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="600" height="600" fill="url(#studioBg)"/>

  <!-- Top Visual Target Guidance Badge -->
  <g transform="translate(300, 48)">
    <rect x="-240" y="-22" width="480" height="44" rx="22" fill="#1C1917" stroke="#D97706" stroke-width="1.5"/>
    <text x="0" y="5" fill="#FDE047" font-size="13" font-family="sans-serif" font-weight="900" text-anchor="middle" letter-spacing="1.5">
      ${angleBadge}
    </text>
  </g>

  <!-- Velvet Counter Stage / Pedestal -->
  <ellipse cx="300" cy="470" rx="230" ry="42" fill="#14110E" stroke="#3D3224" stroke-width="2"/>
  <ellipse cx="300" cy="460" rx="200" ry="32" fill="#1F1A14" opacity="0.8"/>
  <ellipse cx="300" cy="455" rx="160" ry="24" fill="#2E261D" opacity="0.6"/>

  <!-- Jewelry Illustration -->
  <g filter="url(#softGlow)">
    ${graphicSvg}
  </g>

  <!-- Footer Technical Verification Overlay -->
  <rect x="30" y="515" width="540" height="60" rx="14" fill="#14110E" stroke="#292524" stroke-width="1"/>
  <text x="50" y="540" fill="#FDE047" font-size="12" font-family="sans-serif" font-weight="bold" letter-spacing="1">
    RL JEWELS • ${purity.toUpperCase()} ${normType.toUpperCase()}
  </text>
  <text x="50" y="560" fill="#A8A29E" font-size="11" font-family="sans-serif">
    Target: ${angleDesc}
  </text>

  <rect x="440" y="528" width="115" height="32" rx="8" fill="#DC2626"/>
  <text x="497" y="548" fill="#FFFFFF" font-size="10" font-family="sans-serif" font-weight="bold" text-anchor="middle" letter-spacing="1">
    GUIDE MOCKUP
  </text>
</svg>
  `.trim();

  try {
    const base64 = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${base64}`;
  } catch (e) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
}
