import React, { useMemo, useState, useEffect } from 'react';

export default function BubbleSelector({ countries, selectedIso, onSelect }) {
  const [hoveredIso, setHoveredIso] = useState(null);
  const [windowSize, setWindowSize] = useState({ 
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Sort by count descending so largest/most important are in the center
  const sortedCountries = useMemo(() => {
    return [...countries].sort((a, b) => (b.count || 0) - (a.count || 0));
  }, [countries]);

  const count = sortedCountries.length;
  
  // Responsive sizing logic
  const isMobile = windowSize.width < 768; // Tablet/Mobile
  const isSmallLaptop = windowSize.width < 1280 && windowSize.height < 800;
  
  // Base size reduced further to 300 to be very compact
  const baseSize = 300;
  
  // Responsive scaling
  // - Mobile (< 768): Smallest
  // - Small Laptop (< 1280): Compact
  // - Standard Laptop (1360x768 etc): Current "perfect" size (0.9 scale)
  // - Large Screen (> 1600): Larger
  const isLargeScreen = windowSize.width > 1600;
  
  const scaleRatio = isMobile 
    ? 0.55 
    : (isSmallLaptop 
        ? 0.75 
        : (isLargeScreen ? 1.3 : 0.9)
      );
      
  const containerSize = baseSize * scaleRatio;
  
  const radius = containerSize / 2;
  // Minimal padding
  const padding = 5 * scaleRatio;

  // Generate Hex Grid Points (normalized distance 1)
  const hexPoints = useMemo(() => {
    if (count === 0) return [];
    // Center
    const points = [{x: 0, y: 0, q: 0, r: 0}];
    if (count === 1) return points;

    let k = 1;
    // Directions: [dq, dr]
    // Moving in these directions traces a hexagonal ring
    const directions = [
        [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]
    ];

    while (points.length < count) {
      let q = 0 + directions[4][0] * k;
      let r = 0 + directions[4][1] * k;
      
      for (let i = 0; i < 6; i++) {
        const dir = directions[i];
        for (let step = 0; step < k; step++) {
             // Convert axial to XY (unit distance 1)
             // x = q + r/2
             // y = sqrt(3)/2 * r
             // We rotate 30 degrees to align flat top or pointy top?
             // Standard conversion:
             // x = size * sqrt(3) * (q + r/2)
             // y = size * 3/2 * r
             // Let's use simplified unit distance:
             const x = q + r * 0.5;
             const y = r * 0.8660254; // sqrt(3)/2
             
             points.push({ x, y, q, r });
             if (points.length >= count) break;

             q += dir[0];
             r += dir[1];
        }
        if (points.length >= count) break;
      }
      k++;
    }
    return points;
  }, [count]);

  // Calculate scale to fit container
  const { bubbleSize, scale } = useMemo(() => {
    if (count === 0) return { bubbleSize: 0, scale: 0 };
    
    // Find max distance from center in the grid
    let maxDist = 0;
    for (const p of hexPoints) {
      const d = Math.sqrt(p.x * p.x + p.y * p.y);
      if (d > maxDist) maxDist = d;
    }

    // Constraints:
    // Scale * maxDist + bubbleRadius <= AvailableRadius
    // spacingFactor = Scale / bubbleDiameter (>= 1.0 for no overlap)
    const spacingFactor = 1.05; // 5% gap
    const R_avail = radius - padding;
    
    // D = 2 * bubbleRadius
    // Scale = D * spacingFactor
    // (D * spacingFactor) * maxDist + D/2 <= R_avail
    // D * (spacingFactor * maxDist + 0.5) <= R_avail
    // D <= R_avail / (spacingFactor * maxDist + 0.5)
    
    const denom = spacingFactor * maxDist + 0.5;
    let D = R_avail / denom;
    
    // Clamp sizes - reduced max size further
    D = Math.max(12, Math.min(50, D));
    
    // Tighter spacing factor - touching or slight overlap is fine for organic look
    const Scale = D * 0.95;
    
    return { bubbleSize: D, scale: Scale };
  }, [hexPoints, radius]);

  const bubbles = useMemo(() => {
    return sortedCountries.map((country, i) => {
      const p = hexPoints[i];
      return {
        ...country,
        x: radius + p.x * scale,
        y: radius + p.y * scale
      };
    });
  }, [sortedCountries, hexPoints, radius, scale]);

  // Helper to find hovered country object for display
  const hoveredCountry = useMemo(() => {
    if (!hoveredIso) return null;
    return countries.find(c => c.iso === hoveredIso);
  }, [hoveredIso, countries]);

  return (
    <div style={{
      position: 'absolute',
      bottom: 20,
      left: 20,
      width: containerSize,
      height: containerSize,
      background: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(12px)',
      borderRadius: '50%',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      zIndex: 60,
      transformOrigin: 'bottom left', 
      transition: 'width 0.3s ease, height 0.3s ease'
    }}>
      {/* Hover Modal / Tooltip */}
      {hoveredCountry && (
        <div style={{
            position: 'absolute',
            top: -40,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            padding: '8px 16px',
            borderRadius: 8,
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            pointerEvents: 'none'
        }}>
            {hoveredCountry.name}
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, textAlign: 'center' }}>
                {hoveredCountry.count ? `${hoveredCountry.count.toLocaleString()} mentions` : ''}
            </div>
        </div>
      )}

      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {bubbles.map((country) => {
          const isSelected = selectedIso === country.iso;
          const isHovered = hoveredIso === country.iso;
          const scaleFactor = isSelected ? (isHovered ? 1.35 : 1.25) : (isHovered ? 1.15 : 1);
          
          return (
            <button
              key={country.iso}
              onMouseEnter={() => setHoveredIso(country.iso)}
              onMouseLeave={() => setHoveredIso(null)}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(country.iso === selectedIso ? null : country.iso);
              }}
              title={`${country.name} (${country.count || 0} mentions)`}
              style={{
                position: 'absolute',
                left: country.x,
                top: country.y,
                width: bubbleSize,
                height: bubbleSize,
                transform: `translate(-50%, -50%) scale(${scaleFactor})`,
                borderRadius: '50%',
                border: isSelected ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                background: isSelected ? '#4494ff' : 'rgba(30, 41, 59, 0.6)',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.2s ease, border-color 0.2s',
                zIndex: isSelected || isHovered ? 20 : 1,
                boxShadow: isSelected ? '0 0 15px rgba(68, 148, 255, 0.6)' : 'none'
              }}
            >
              <img 
                src={`https://flagcdn.com/w80/${country.iso.toLowerCase()}.png`} 
                alt={country.iso}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: isSelected ? 1 : 0.8,
                  borderRadius: '50%'
                }}
                onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentNode.innerText = country.iso;
                    e.target.parentNode.style.fontSize = `${Math.max(8, bubbleSize * 0.4)}px`;
                    e.target.parentNode.style.color = '#ccc';
                }}
              />
            </button>
          );
        })}
      </div>
      
      <div style={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 10,
        color: '#94a3b8',
        textTransform: 'uppercase',
        letterSpacing: 1,
        pointerEvents: 'none',
        background: 'rgba(15, 23, 42, 0.95)',
        padding: '4px 10px',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        whiteSpace: 'nowrap',
        zIndex: 20
      }}>
        Select Country
      </div>
    </div>
  );
}
