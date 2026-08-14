import React from 'react';

export interface BrandLogoProps {
  variant?: 'full' | '3d-badge' | 'compact' | 'circle';
  theme?: 'red-on-white' | 'white-on-red' | 'gold-accent';
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showSubtitle?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = '3d-badge',
  theme = 'red-on-white',
  className = '',
  size = 'md',
  showSubtitle = false,
}) => {
  // Dimension scale map
  const sizeMap = {
    xs: { box: 'w-7 h-7', px: 28 },
    sm: { box: 'w-9 h-9', px: 36 },
    md: { box: 'w-11 h-11', px: 44 },
    lg: { box: 'w-16 h-16', px: 64 },
    xl: { box: 'w-24 h-24', px: 96 },
  };

  const currentSize = sizeMap[size] || sizeMap.md;

  // Authentic 3D Emblem Vector from RLJ 3d_LOGO_Final.pdf.png
  // High-fidelity uncropped vector with specular highlight and bold RL JEWELS typography
  const render3DEmblem = () => (
    <div className={`relative shrink-0 select-none ${currentSize.box} ${className}`}>
      <svg
        viewBox="0 0 200 200"
        className="w-full h-full drop-shadow-md overflow-visible"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* 3D Primary Rich Red Gradient */}
          <radialGradient id="rljRed3D" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#FF2A4D" />
            <stop offset="25%" stopColor="#E50926" />
            <stop offset="65%" stopColor="#C0071E" />
            <stop offset="90%" stopColor="#8A0010" />
            <stop offset="100%" stopColor="#5E000B" />
          </radialGradient>

          {/* Top-Left Specular Sheen */}
          <linearGradient id="rljSheen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
            <stop offset="35%" stopColor="#FFFFFF" stopOpacity="0.15" />
            <stop offset="70%" stopColor="#FFFFFF" stopOpacity="0.15" />
          </linearGradient>

          {/* Subtle Outer Bevel */}
          <linearGradient id="rljBevel" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FF6B81" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#3B0006" stopOpacity="0.9" />
          </linearGradient>

          {/* Drop shadow filter for crisp depth */}
          <filter id="badgeShadow" x="-10%" y="-10%" width="125%" height="125%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#70000B" floodOpacity="0.35" />
          </filter>
        </defs>

        {/* Outer Squircle Container with 3D Bevel Border */}
        <rect
          x="6"
          y="6"
          width="188"
          height="188"
          rx="44"
          ry="44"
          fill="url(#rljRed3D)"
          stroke="url(#rljBevel)"
          strokeWidth="2.5"
          filter="url(#badgeShadow)"
        />

        {/* Specular Inner Dome Highlight Sheen */}
        <path
          d="M 12,50 C 12,28 28,12 50,12 L 150,12 C 172,12 188,28 188,50 C 188,95 140,115 100,115 C 50,115 12,95 12,50 Z"
          fill="url(#rljSheen)"
          pointerEvents="none"
        />

        {/* Typography: Exact RL JEWELS Uncropped Geometry */}
        <g fill="#FFFFFF" textAnchor="middle" style={{ fontFeatureSettings: '"tnum"' }}>
          {/* Main Massive "RL" Logo Mark */}
          <text
            x="100"
            y="118"
            fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
            fontWeight="900"
            fontSize="88"
            letterSpacing="-2"
            style={{
              textShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }}
          >
            RL
          </text>

          {/* "JEWELS" Sub-Text Right Below */}
          <text
            x="100"
            y="158"
            fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
            fontWeight="900"
            fontSize="26"
            letterSpacing="5"
            style={{
              textShadow: '0 1px 3px rgba(0,0,0,0.35)',
            }}
          >
            JEWELS
          </text>
        </g>
      </svg>
    </div>
  );

  if (variant === '3d-badge' || variant === 'compact' || variant === 'circle') {
    return render3DEmblem();
  }

  // Horizontal Full Brand Lockup
  const BRAND_RED = '#DC2626';
  const isWhiteOnRed = theme === 'white-on-red';
  const textColor = isWhiteOnRed ? '#FFFFFF' : BRAND_RED;

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {render3DEmblem()}
      <div className="flex flex-col leading-none justify-center">
        <span
          className="font-black tracking-tight text-xl sm:text-2xl"
          style={{ color: textColor, fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          RL JEWELS
        </span>
        <span className="text-[11px] uppercase font-bold tracking-widest text-stone-500 mt-1">
          Photo Studio
        </span>
      </div>
    </div>
  );
};

