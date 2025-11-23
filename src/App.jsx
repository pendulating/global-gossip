import React, { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { MapView, _GlobeView as GlobeView, COORDINATE_SYSTEM, FlyToInterpolator } from '@deck.gl/core';
import { SolidPolygonLayer, GeoJsonLayer, ArcLayer, ScatterplotLayer, IconLayer } from '@deck.gl/layers';
import NewspaperOverlay from './Newspaper.jsx';
import BubbleSelector from './BubbleSelector.jsx';

const WORLD_LOCAL_URL = './world_countries.geojson';
const WORLD_REMOTE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const ARC_URL = './cross_country_mentions_by_year.json';

const INITIAL_VIEW_STATE = {
  longitude: 0,
  latitude: 20,
  zoom: 1.2,
  minZoom: 0.5,
  maxZoom: 5,
  pitch: 0,
  bearing: 0,
  padding: { bottom: 400 }
};

const ARC_DEFAULT_MIN_SHARE = 0.02;
const ARC_MAX_SEGMENTS = 600;
const ARC_SHARE_HIGHLIGHT = 0.2;
const ARC_FIXED_ALPHA = 128;
const BASE_LAND_COLOR = [60, 65, 85, 220];
const ACTIVE_COUNTRY_COLOR = [118, 185, 98, 230];
const ORANGE_COLOR = [249, 115, 22];
const BLUE_COLOR = [68, 148, 255];
const BROWN_COLOR = [165, 128, 92];

const ARROW_SVG = '<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path fill="#FFFFFF" d="M11 28.5v-10l-5.5 5.5L0 18.05l16-16 16 16-.5.5L18 18.5v10h-7z"/></svg>';
const ARROW_ICON = {
  url: `data:image/svg+xml,${encodeURIComponent(ARROW_SVG)}`,
  width: 32,
  height: 32,
  anchorY: 16,
  anchorX: 16
};

function computeBearing([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const phi1 = lat1 * rad;
  const phi2 = lat2 * rad;
  const dLon = (lon2 - lon1) * rad;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const bearing = Math.atan2(y, x) * (180 / Math.PI);
  return (bearing + 360) % 360;
}

export default function App() {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [size, setSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720
  }));
  const [landData, setLandData] = useState(null);
  const [arcData, setArcData] = useState([]);
  const [arcYears, setArcYears] = useState([]);
  const [arcYearIndex, setArcYearIndex] = useState(0);
  const [aggregateAllTime, setAggregateAllTime] = useState(false);
  const [arcMinShare, setArcMinShare] = useState(ARC_DEFAULT_MIN_SHARE);
  const [arcMaxVisible, setArcMaxVisible] = useState(400);
  const [hoverIso, setHoverIso] = useState(null);
  const [pinnedIso, setPinnedIso] = useState(null);
  const [hoverModal, setHoverModal] = useState(null);
  const [selectedBubbleIso, setSelectedBubbleIso] = useState(null);
  const [isGlobe, setIsGlobe] = useState(false);
  const [arcsVisible, setArcsVisible] = useState(true);
  const deckRef = useRef(null);
  const timeoutRef = useRef(null);
  const rotationLonRef = useRef(0);

  useEffect(() => {
    if (hasInteracted || !size.width) return;
    const baseWidth = 1024;
    const zoom = Math.log2(Math.max(size.width, 1) / baseWidth);
    setViewState(prev => ({
      ...prev,
      zoom: Math.max(Math.min(zoom, 4.5), 0.5)
    }));
  }, [size.width, hasInteracted]);

  const countryLabels = useMemo(() => {
    if (!landData) return new Map();
    const features = landData.features || [];

    const flattenCoords = coords => {
      const points = [];
      const traverse = node => {
        if (!node) return;
        if (typeof node[0] === 'number') {
          points.push(node);
          return;
        }
        for (const child of node) traverse(child);
      };
      traverse(coords);
      return points;
    };

    const computeCentroid = geometry => {
      if (!geometry?.coordinates) return null;
      const pts = flattenCoords(geometry.coordinates);
      if (!pts.length) return null;
      let lon = 0;
      let lat = 0;
      for (const [x, y] of pts) {
        lon += x;
        lat += y;
      }
      const count = pts.length;
      return { lon: lon / count, lat: lat / count };
    };

    const map = new Map();
    for (const f of features) {
      const props = f?.properties || {};
      const iso = (props.ISO_A2 || props.iso_a2 || props.ISO_A2_EH || '').toUpperCase();
      if (!iso) continue;
      let lon = props.LABEL_X;
      let lat = props.LABEL_Y;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        const centroid = computeCentroid(f.geometry);
        if (centroid) {
          lon = centroid.lon;
          lat = centroid.lat;
        }
      }
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const name = props.ADMIN || props.NAME || iso;
      map.set(iso, { lon, lat, name });
    }
    return map;
  }, [landData]);

  useEffect(() => {
    if (!isGlobe) {
        setArcsVisible(true);
        if (selectedBubbleIso) {
            setViewState(prev => ({
                ...prev,
                padding: { bottom: 400 }
            }));
        } else {
            setViewState(prev => {
                const { padding, ...rest } = prev;
                return rest;
            });
        }
        return;
    }

    if (selectedBubbleIso) {
        const label = countryLabels.get(selectedBubbleIso);
        
        // Robust cleanup for any previous pending timer
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        if (label) {
            // 1. Glide to country immediately
            // Arcs will update automatically via visibleRows (no artificial delay needed)
            setArcsVisible(true); 
            
            setViewState(prev => ({
                ...prev,
                longitude: label.lon,
                latitude: label.lat,
                zoom: 2.0,
                transitionDuration: 2000,
                transitionInterpolator: new FlyToInterpolator(),
                padding: { bottom: 400 }
            }));

            // 2. Zoom out after glide
            timeoutRef.current = setTimeout(() => {
                setViewState(prev => ({
                    ...prev,
                    zoom: 1.0,
                    latitude: 20,
                    transitionDuration: 2000,
                    transitionInterpolator: new FlyToInterpolator()
                }));
            }, 2200);
        }
    } else {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        // Reset view if needed
        setArcsVisible(true);
        setViewState(prev => ({
            ...prev,
            zoom: 2.0,
            transitionDuration: 1000,
            transitionInterpolator: new FlyToInterpolator()
        }));
    }
    
    return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [selectedBubbleIso, isGlobe, countryLabels]);

  useEffect(() => {
    if (!isGlobe) return;
    
    // Initial globe view setup
    setViewState(prev => ({
      ...prev,
      latitude: 20,
      zoom: 2.0,
      pitch: 0,
      bearing: 0,
      padding: { bottom: 400 }
    }));
    
    // Disabled auto-rotation loop
  }, [isGlobe]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let resp = await fetch(WORLD_LOCAL_URL);
        if (!resp.ok) resp = await fetch(WORLD_REMOTE_URL);
        const json = await resp.json();
        if (!cancelled) setLandData(json);
      } catch (e) {
        console.error('Failed loading world data', e);
      }
    })();
    (async () => {
      try {
        const resp = await fetch(ARC_URL);
        if (!resp.ok) {
            console.error('Fetch failed for arc data', resp.status, resp.statusText);
            return;
        }
        const json = await resp.json();
        if (cancelled) return;
        const records = Array.isArray(json) ? json : [];
        setArcData(records);
        const years = Array.from(new Set(records.map(r => Number(r.year)).filter(Number.isFinite))).sort((a, b) => a - b);
        if (years.length) {
          setArcYears(years);
          setArcYearIndex(0);
        }
      } catch (e) {
        console.error('Failed loading arc data', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const pairData = useMemo(() => {
    if (!landData || !arcData.length || !countryLabels.size) {
      return { pairs: [], year: null, labelIndex: countryLabels, allSourceIsos: [], sourceCounts: new Map() };
    }
    const selectedYear =
      aggregateAllTime || !arcYears.length ? null : arcYears[arcYearIndex % arcYears.length];
    const labelIndex = countryLabels;
    const allSourceIsos = new Set();
    const sourceCounts = new Map();

    const directionMap = new Map();
    for (const entry of arcData) {
      const entryYear = Number(entry.year);
      if (!Number.isFinite(entryYear)) continue;
      if (!aggregateAllTime && entryYear !== selectedYear) continue;
      const sourceIso = (entry.source_country || '').toUpperCase();
      const targetIso = (entry.mentioned_country || '').toUpperCase();
      if (!sourceIso || !targetIso || sourceIso === targetIso) continue;
      
      const mentions = Number(entry.mention_occurrences) || 0;
      allSourceIsos.add(sourceIso);
      sourceCounts.set(sourceIso, (sourceCounts.get(sourceIso) || 0) + mentions);

      const sourceLabel = labelIndex.get(sourceIso);
      const targetLabel = labelIndex.get(targetIso);
      if (!sourceLabel || !targetLabel) continue;
      const row = {
        year: aggregateAllTime ? 'All years' : entryYear,
        source_country: sourceIso,
        target_country: targetIso,
        sourceName: sourceLabel.name,
        targetName: targetLabel.name,
        sourcePosition: [sourceLabel.lon, sourceLabel.lat],
        targetPosition: [targetLabel.lon, targetLabel.lat],
        mention_occurrences: mentions,
        mention_share: Number(entry.mention_share) || 0,
        article_hits: Number(entry.article_hits) || 0
      };
      const key = [sourceIso, targetIso].sort().join('--');
      let record = directionMap.get(key);
      if (!record) {
        record = { isoA: sourceIso < targetIso ? sourceIso : targetIso, isoB: sourceIso < targetIso ? targetIso : sourceIso, rows: {} };
        directionMap.set(key, record);
      }
      record.rows[sourceIso] = row;
    }

    const pairs = [];
    directionMap.forEach(record => {
      pairs.push(record);
    });
    return { pairs, year: selectedYear ?? 'All years', labelIndex, allSourceIsos: Array.from(allSourceIsos), sourceCounts };
  }, [landData, arcData, arcYears, arcYearIndex, aggregateAllTime, countryLabels]);

  const activeIso = selectedBubbleIso;

  // Calculate available countries for bubbles
  const availableCountries = useMemo(() => {
    if (!pairData.allSourceIsos || !pairData.labelIndex) return [];
    return pairData.allSourceIsos
        .map(iso => {
            const label = pairData.labelIndex.get(iso);
            return {
                iso,
                name: label?.name || iso,
                count: pairData.sourceCounts?.get(iso) || 0,
                hasLabel: !!label
            };
        })
        .filter(c => c.hasLabel); // Filter out countries with no map coordinates
  }, [pairData]);

  const visibleRows = useMemo(() => {
    if (!activeIso || !pairData.pairs.length) return [];
    const rows = [];
    for (const record of pairData.pairs) {
      const { isoA, isoB, rows: pairRows } = record;
      if (isoA !== activeIso && isoB !== activeIso) continue;
      const otherIso = isoA === activeIso ? isoB : isoA;
      const activeRow = pairRows[activeIso];
      const otherRow = pairRows[otherIso];
      const activeCount = activeRow?.mention_occurrences || 0;
      const otherCount = otherRow?.mention_occurrences || 0;
      if (!activeCount && !otherCount) continue;
      if (activeCount === otherCount) continue;
      const activeShare = activeRow?.mention_share || 0;
      const otherShare = otherRow?.mention_share || 0;
      const dominantShare = activeCount > otherCount ? activeShare : otherShare;
      if (dominantShare < arcMinShare) continue;
      const winnerIsActive = activeCount > otherCount;
      const dominantCount = winnerIsActive ? activeCount : otherCount;
      const weakerCount = winnerIsActive ? otherCount : activeCount;
      const totalArticles = activeCount + otherCount;
      if (totalArticles === 0) continue;
      const ratio = activeCount / Math.max(otherCount, 1);
      const sourceIso = winnerIsActive ? activeIso : otherIso;
      const targetIso = winnerIsActive ? otherIso : activeIso;
      const sourceRow = winnerIsActive ? activeRow : otherRow;
      const targetRow = winnerIsActive ? otherRow : activeRow;
      const sourceLabel = pairData.labelIndex.get(sourceIso);
      const targetLabel = pairData.labelIndex.get(targetIso);
      const sourcePosition = sourceRow?.sourcePosition || (sourceLabel ? [sourceLabel.lon, sourceLabel.lat] : null);
      const targetPosition = targetRow?.sourcePosition || (targetLabel ? [targetLabel.lon, targetLabel.lat] : null);
      if (!sourcePosition || !targetPosition) continue;
      const bearing = computeBearing(sourcePosition, targetPosition);
      rows.push({
        year: pairData.year,
        direction: winnerIsActive ? 'outbound' : 'inbound',
        source_country: sourceIso,
        target_country: targetIso,
        sourceName: sourceRow?.sourceName || sourceLabel?.name || sourceIso,
        targetName: targetRow?.sourceName || targetLabel?.name || targetIso,
        sourcePosition,
        targetPosition,
        mention_occurrences: dominantCount,
        counterpart_mentions: weakerCount,
        total_articles: totalArticles,
        ratio,
        bearing,
        mention_share: dominantShare
      });
    }
    rows.sort((a, b) => (b.mention_occurrences || 0) - (a.mention_occurrences || 0));
    return rows.slice(0, arcMaxVisible);
  }, [activeIso, pairData, arcMinShare, arcMaxVisible]);

  const visibleIsos = useMemo(() => {
    const set = new Set();
    for (const row of visibleRows) {
      set.add(row.source_country);
      set.add(row.target_country);
    }
    return set;
  }, [visibleRows]);

  const mixColors = (c1, c2, t) => [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t)
  ];
  
  const PURPLE_COLOR = [147, 51, 234]; // Purple for roughly equal coverage

  const colorFromShareRatio = ratio => {
    if (!Number.isFinite(ratio)) return BLUE_COLOR; // Default fallback
    
    // Logic: 
    // ratio = Ego Mentions / Partner Mentions
    // If ratio > 1.5 -> Ego talks more -> Blue
    // If ratio < (1/1.5) = 0.66 -> Partner talks more -> Orange
    // Otherwise -> Roughly equal -> Purple
    
    // Note: The 'ratio' passed in here comes from visibleRows which computes:
    // const ratio = activeCount / Math.max(otherCount, 1);
    // And it also swaps active/other based on winner.
    // So 'ratio' in visibleRows is ALWAYS >= 1.0 (Dominant / Weaker).
    
    // We need to check if that dominant ratio is effectively "equal".
    // Threshold: < 1.5
    
    if (ratio < 1.5) {
        return PURPLE_COLOR;
    }
    
    // If we are here, ratio >= 1.5, meaning there is a clear dominant direction.
    // In visibleRows, we determine direction.
    // But this function just takes 'ratio'.
    // Wait, 'colorFromShareRatio' is called in ArcLayer with 'd.ratio'.
    // And 'd.ratio' is Dominant/Weaker.
    // BUT we need to know WHICH one is dominant to assign Blue vs Orange?
    // Actually, ArcLayer uses:
    // getSourceColor: d => [...colorFromShareRatio(d.ratio), ARC_FIXED_ALPHA]
    
    // The previous logic was mixing colors based on ratio.
    // The previous logic used 'ratio' as a float where:
    // If > 1: Mix Brown -> Blue
    // If < 1: Mix Orange -> Brown (but ratio was clamped to 0)
    
    // However, looking at visibleRows:
    // const ratio = activeCount / Math.max(otherCount, 1);
    // This ratio is ALWAYS >= 0. If active > other, ratio > 1. If active < other, ratio < 1.
    
    // Wait, let's re-read visibleRows logic carefully:
    /*
      const ratio = activeCount / Math.max(otherCount, 1);
      const sourceIso = winnerIsActive ? activeIso : otherIso;
    */
    // 'ratio' here is (Active Count) / (Other Count).
    // So:
    // If Active (Ego) > Other -> Ratio > 1.0 -> Blue-ish
    // If Active (Ego) < Other -> Ratio < 1.0 -> Orange-ish
    
    // New Logic with Threshold 1.5 (and 1/1.5 = 0.666):
    // Ratio > 1.5 => Ego Dominant => BLUE
    // Ratio < 0.666 => Other Dominant => ORANGE
    // 0.666 <= Ratio <= 1.5 => Equal => PURPLE
    
    if (ratio > 1.5) return BLUE_COLOR;
    if (ratio < 0.6666) return ORANGE_COLOR;
    return PURPLE_COLOR;
  };

  const arcLayer = useMemo(() => {
    // Always render arc layer if we have rows, let the transition prop handle the visual "growth"
    if (!visibleRows.length) return null;
    return new ArcLayer({
      id: 'net-arcs',
      data: visibleRows,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      greatCircle: true,
      wrapLongitude: true,
      getSourcePosition: d => d.sourcePosition,
      getTargetPosition: d => d.targetPosition,
      getSourceColor: d => [...colorFromShareRatio(d.ratio), ARC_FIXED_ALPHA],
      getTargetColor: d => [...colorFromShareRatio(d.ratio), ARC_FIXED_ALPHA],
      getWidth: d => 1 + Math.log2(d.total_articles + 1),
      pickable: true,
      // Only hide if explicitly told to via arcsVisible, BUT for rapid clicking we might want them shown?
      // If we remove !arcsVisible check here, they will appear immediately.
      // The user said "arcs should always occur as soon as the click occurs".
      // So we remove the !arcsVisible gate here.
      visible: arcsVisible, 
      parameters: { depthTest: true, blend: true },
      transitions: {
        getWidth: {
          duration: 1000,
          enter: () => 0
        },
        getSourceColor: {
          duration: 1000,
          enter: () => [0, 0, 0, 0]
        },
        getTargetColor: {
           duration: 1000,
           enter: () => [0, 0, 0, 0]
        }
      }
    });
  }, [visibleRows, arcsVisible]);

  const arcNodeLayer = useMemo(() => {
    if (!visibleRows.length || !arcsVisible) return null;
    const nodeMap = new Map();
    for (const row of visibleRows) {
      const weight = row.mention_occurrences || 0;
      const add = (iso, position, name) => {
        const existing = nodeMap.get(iso);
        if (existing) existing.total += weight;
        else nodeMap.set(iso, { id: iso, position, name, total: weight });
      };
      add(row.source_country, row.sourcePosition, row.sourceName);
      add(row.target_country, row.targetPosition, row.targetName);
    }
    const nodes = Array.from(nodeMap.values());
    const maxWeight = nodes.reduce((max, node) => Math.max(max, node.total || 0), 0) || 1;
    return new ScatterplotLayer({
      id: 'net-nodes',
      data: nodes,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      getPosition: d => d.position,
      getFillColor: [15, 23, 42, 230],
      getLineColor: [255, 255, 255, 200],
      getRadius: d => 80000 + 600000 * Math.sqrt((d.total || 0) / maxWeight),
      stroked: true,
      filled: true,
      pickable: true,
      radiusUnits: 'meters',
      parameters: { depthTest: true }
    });
  }, [visibleRows]);

  const arrowLayer = useMemo(() => {
    if (!visibleRows.length || !arcsVisible) return null;
    return new IconLayer({
      id: 'direction-arrows',
      data: visibleRows,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      getIcon: () => ARROW_ICON,
      sizeUnits: 'meters',
      sizeScale: 5000,
      getPosition: d => d.targetPosition,
      getAngle: d => d.bearing,
      getColor: d => [...colorFromShareRatio(d.ratio), 220],
      parameters: { depthTest: true }
    });
  }, [visibleRows]);

  const backgroundLayer = useMemo(() => new SolidPolygonLayer({
    id: 'map-background',
    data: [
      // Standard full-sphere coverage polygon for GlobeView
      [[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]
    ],
    getPolygon: d => d,
    stroked: false,
    filled: true,
    pickable: false,
    opacity: 1,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
    getFillColor: [30, 40, 70],
    // Explicitly disable culling for the background to ensure it renders regardless of winding/camera angle
    // We want this solid sphere to always exist.
    parameters: { depthTest: true, depthWrite: true, cull: false } 
  }), []);

  const landLayer = useMemo(() => {
    if (!landData) return null;
    const data = landData.type === 'FeatureCollection' ? landData.features : landData;
    return new GeoJsonLayer({
      id: 'land',
      data,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      filled: true,
      stroked: true,
      getFillColor: BASE_LAND_COLOR,
      getLineColor: [120, 130, 150, 160],
      lineWidthMinPixels: 0.5,
      pickable: true,
      parameters: { depthTest: true }
    });
  }, [landData]);

  const activeCountriesLayer = useMemo(() => {
    if (!landData || !visibleRows.length || !visibleIsos.size || !arcsVisible) return null;
    const features = (landData.features || []).filter(f => {
      const props = f.properties || {};
      const iso = (props.ISO_A2 || props.iso_a2 || props.ISO_A2_EH || '').toUpperCase();
      return iso && visibleIsos.has(iso);
    });
    if (!features.length) return null;
    return new GeoJsonLayer({
      id: 'active-countries',
      data: { type: 'FeatureCollection', features },
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      filled: true,
      stroked: false,
      getFillColor: ACTIVE_COUNTRY_COLOR,
      pickable: true,
      parameters: { depthTest: true }
    });
  }, [landData, visibleRows, visibleIsos]);

  const layers = useMemo(
    () => {
      // Order matters: Background must be first to write to depth buffer for occlusion
      return [backgroundLayer, landLayer, activeCountriesLayer, arcLayer, arcNodeLayer, arrowLayer].filter(Boolean);
    },
    [backgroundLayer, landLayer, activeCountriesLayer, arcLayer, arcNodeLayer, arrowLayer]
  );

  const deckTooltip = ({ object, layer }) => {
    if (!object || layer?.id !== 'net-arcs') return null;
    const sharePct = ((object.mention_share || 0) * 100).toFixed(2);
    const ratio = object.ratio ? object.ratio.toFixed(2) : '—';
    const directionLabel = object.direction === 'inbound' ? 'Inbound (others → ego)' : 'Outbound (ego → others)';
    return {
      html: `
        <div class="tooltip-country">${object.sourceName} → ${object.targetName}</div>
        <div class="tooltip-row"><span class="tooltip-label">Year:</span><span class="tooltip-value">${object.year ?? '—'}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">${directionLabel}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Dominant mentions:</span><span class="tooltip-value">${Number(object.mention_occurrences || 0).toLocaleString()}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Counter mentions:</span><span class="tooltip-value">${Number(object.counterpart_mentions || 0).toLocaleString()}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Total articles:</span><span class="tooltip-value">${Number(object.total_articles || 0).toLocaleString()}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${sharePct}%</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Ratio (Ego/Target):</span><span class="tooltip-value">${ratio}</span></div>`
    };
  };

  const arcSummary = useMemo(() => {
    // Total rows for the current active country before filtering by share or max count
    if (!activeIso || !pairData.pairs.length) return { year: aggregateAllTime ? 'All years' : pairData.year ?? '—', shown: 0, available: 0 };
    
    let totalAvailable = 0;
    for (const record of pairData.pairs) {
        const { isoA, isoB, rows: pairRows } = record;
        if (isoA !== activeIso && isoB !== activeIso) continue;
        
        // We only count this pair if it has data relevant to the current activeIso
        // similar to how visibleRows does its initial check
        const otherIso = isoA === activeIso ? isoB : isoA;
        const activeRow = pairRows[activeIso];
        const otherRow = pairRows[otherIso];
        const activeCount = activeRow?.mention_occurrences || 0;
        const otherCount = otherRow?.mention_occurrences || 0;
        
        if (!activeCount && !otherCount) continue;
        totalAvailable++;
    }

    return {
        year: aggregateAllTime ? 'All years' : pairData.year ?? '—',
        shown: visibleRows.length,
        available: totalAvailable
    };
  }, [pairData, visibleRows, activeIso, aggregateAllTime]);

  const leaderboardData = useMemo(() => {
    if (!activeIso) return null;
    const blue = [];
    const orange = [];
    const purple = []; // New category for equal coverage
    for (const row of visibleRows) {
      const isOutbound = row.direction === 'outbound';
      const partnerIso = isOutbound ? row.target_country : row.source_country;
      const partnerName = isOutbound ? row.targetName : row.sourceName;
      // egoToPartner = Blue = Ego -> Partner mentions
      // partnerToEgo = Orange = Partner -> Ego mentions
      // If outbound (ego dominates), mention_occurrences is ego->partner
      // If inbound (partner dominates), mention_occurrences is partner->ego
      const egoToPartner = isOutbound ? row.mention_occurrences : row.counterpart_mentions;
      const partnerToEgo = isOutbound ? row.counterpart_mentions : row.mention_occurrences;
      
      const ratio = egoToPartner / Math.max(partnerToEgo, 1);
      const isPurple = ratio >= 0.6666 && ratio <= 1.5;

      const item = {
        iso: partnerIso,
        name: partnerName,
        egoToPartner,
        partnerToEgo,
        total: egoToPartner + partnerToEgo,
        isPurple
      };

      if (isPurple) purple.push(item);
      else if (isOutbound) blue.push(item);
      else orange.push(item);
    }
    return {
      blue: blue.sort((a, b) => b.egoToPartner - a.egoToPartner).slice(0, 20),
      orange: orange.sort((a, b) => b.partnerToEgo - a.partnerToEgo).slice(0, 20),
      purple: purple.sort((a, b) => b.total - a.total).slice(0, 20)
    };
  }, [activeIso, visibleRows]);

  const focusLabel = useMemo(() => {
    if (activeIso) {
      const label = pairData.labelIndex.get(activeIso);
      return label?.name || activeIso;
    }
    return 'Hover a country';
  }, [activeIso, pairData]);

  const getIsoFromInfo = info => {
    if (!info?.object) return null;
    const layerId = info.layer?.id;
    if (layerId === 'land' || layerId === 'active-countries') {
      const props = info.object.properties || {};
      const iso = (props.ISO_A2 || props.iso_a2 || props.ISO_A2_EH || '').toUpperCase();
      return iso || null;
    }
    if (layerId === 'net-nodes') {
      return info.object.id || null;
    }
    return null;
  };

  const projectLabelToScreen = iso => {
    const deckComponent = deckRef.current;
    const deck = deckComponent?.deck;
    const label = countryLabels.get(iso);
    if (!deck || !label) return null;
    const { lon, lat } = label;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const viewports =
      typeof deck.getViewports === 'function' ? deck.getViewports() : deck.viewManager?.getViewports?.();
    const viewport = Array.isArray(viewports) ? viewports[0] : null;
    if (!viewport || typeof viewport.project !== 'function') return null;
    const [x, y] = viewport.project([lon, lat, 0]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  };

  const buildHoverModal = (iso, info) => {
    if (!iso) return null;
    const label = countryLabels.get(iso);
    const proj = projectLabelToScreen(iso);
    const fallbackX = typeof info?.x === 'number' ? info.x : size.width / 2;
    const fallbackY = typeof info?.y === 'number' ? info.y : size.height / 2;
    const flagUrl = iso.length === 2 ? `https://flagcdn.com/w80/${iso.toLowerCase()}.png` : null;
    const nameFromFeature =
      info?.object?.properties?.ADMIN || info?.object?.properties?.NAME || iso;
    return {
      iso,
      name: label?.name || nameFromFeature,
      flagUrl,
      x: proj?.x ?? fallbackX,
      y: proj?.y ?? fallbackY
    };
  };

  const handleHover = info => {
    // Disabled map hover interaction
    /*
    const iso = getIsoFromInfo(info);
    if (iso) {
      if (!pinnedIso) {
        setHoverIso(prev => (prev === iso ? prev : iso));
      }
      setHoverModal(prev => {
        if (prev?.iso === iso) return prev;
        return buildHoverModal(iso, info);
      });
    } else if (!info.object) {
      if (!pinnedIso) setHoverIso(null);
      setHoverModal(null);
    }
    */
  };

  const handleClick = info => {
    // Disabled map click interaction
    /*
    const iso = getIsoFromInfo(info);
    if (!iso) {
      setPinnedIso(null);
      if (!info.object) setHoverIso(null);
      return;
    }
    if (pinnedIso === iso) {
      setPinnedIso(null);
    } else {
      setPinnedIso(iso);
      setHoverIso(iso);
    }
    */
  };

  const currentView = useMemo(() => {
    if (isGlobe) {
      return new GlobeView({
        id: 'globe',
        controller: { dragPan: true, scrollZoom: false, touchZoom: false, doubleClickZoom: false, keyboard: false, inertia: 0 },
        resolution: 10,
        nearZMultiplier: 0.003,
        farZMultiplier: 30
      });
    }
    return new MapView({ id: 'map', controller: true, wrapLongitude: true });
  }, [isGlobe]);

  const handleViewStateChange = ({ viewState: vs, interactionState }) => {
    if (
      interactionState &&
      (interactionState.isDragging ||
        interactionState.isPanning ||
        interactionState.isZooming ||
        interactionState.startPanPosition)
    ) {
      setHasInteracted(true);
    }

    if (isGlobe) {
      const nextState = { ...vs };
      
      if (interactionState && interactionState.isDragging) {
          nextState.latitude = 20; 
          // Maintain current zoom level during drag
      }
      
      nextState.padding = { bottom: 400 };
      
      setViewState(nextState);
    } else {
      setViewState({ ...vs, padding: { bottom: 400 } });
    }
  };

  const modalIso = hoverModal?.iso;

  useEffect(() => {
    if (!modalIso) return;
    const proj = projectLabelToScreen(modalIso);
    if (!proj) return;
    setHoverModal(prev => {
      if (!prev || prev.iso !== modalIso) return prev;
      const deltaX = Math.abs((prev.x ?? 0) - proj.x);
      const deltaY = Math.abs((prev.y ?? 0) - proj.y);
      if (deltaX < 0.5 && deltaY < 0.5) return prev;
      return { ...prev, x: proj.x, y: proj.y };
    });
  }, [viewState, modalIso, countryLabels]);

  const newspaperProps = useMemo(() => {
    if (!leaderboardData || !activeIso) return null;
    // Find the most significant relationship
    const topBlue = leaderboardData.blue[0];
    const topOrange = leaderboardData.orange[0];
    
    let headline = "Global Mentions Analysis";
    let subhead = "Hover over a country to see details";
    let countryName = pairData.labelIndex.get(activeIso)?.name || activeIso;

    if (topBlue) {
      headline = `${countryName.toUpperCase()} DISCUSSES ${topBlue.name.toUpperCase()}`;
      subhead = `Top Outbound Connection (${topBlue.egoToPartner.toLocaleString()} mentions)`;
    } else if (topOrange) {
      headline = `${countryName.toUpperCase()} IN THE NEWS`;
      subhead = `Mentioned by ${topOrange.name} (${topOrange.partnerToEgo.toLocaleString()} times)`;
    } else {
      headline = `${countryName.toUpperCase()} PERSPECTIVE`;
      subhead = "Exploring global connections";
    }

    return { headline, subhead, countryName };
  }, [leaderboardData, activeIso, pairData]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {newspaperProps && (
        <NewspaperOverlay 
          headline={newspaperProps.headline} 
          subhead={newspaperProps.subhead} 
          countryName={newspaperProps.countryName} 
        />
      )}
      <DeckGL
        ref={deckRef}
        layers={layers}
        views={[currentView]}
        controller={{ dragPan: true, scrollZoom: true, touchZoom: true, doubleClickZoom: true }}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        // GLOBAL CULLING: This is the official fix from deck.gl documentation to hide back-facing geometry in GlobeView
        parameters={{ clearColor: [0.05, 0.08, 0.16, 1], depthTest: true, depthMask: true, blend: true, blendFunc: [770, 771], cull: true }}
        getTooltip={deckTooltip}
        onHover={handleHover}
        onClick={handleClick}
        style={{ position: 'absolute', inset: 0 }}
        glOptions={{ alpha: false }} // Force opaque canvas
      />

      {availableCountries.length > 0 && (
        <BubbleSelector 
            countries={availableCountries}
            selectedIso={selectedBubbleIso}
            onSelect={setSelectedBubbleIso}
        />
      )}

      {hoverModal && (
        <div
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            left: Math.min(Math.max((hoverModal.x || 0) + 18, 10), size.width - 220),
            top: Math.min(Math.max((hoverModal.y || 0) - 30, 10), size.height - 110),
            minWidth: 180,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid rgba(148, 163, 184, 0.35)',
            color: '#e2e8f0',
            boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
            zIndex: 100
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {hoverModal.flagUrl ? (
              <img
                src={hoverModal.flagUrl}
                alt={`${hoverModal.name} flag`}
                style={{ width: 48, height: 32, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(148,163,184,0.5)' }}
              />
            ) : (
              <div style={{ width: 48, height: 32, borderRadius: 4, border: '1px solid rgba(148,163,184,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
                {hoverModal.iso}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Country</span>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{hoverModal.name}</span>
            </div>
          </div>
        </div>
      )}

      {leaderboardData && activeIso && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 320,
            maxHeight: 'calc(100vh - 24px)',
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(15, 23, 42, 0.90)',
            backdropFilter: 'blur(8px)',
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#e2e8f0',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            zIndex: 50
          }}
        >
          <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#94a3b8', marginBottom: 8 }}>
              Ego Country
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
               {activeIso.length === 2 && (
                 <img
                   src={`https://flagcdn.com/w80/${activeIso.toLowerCase()}.png`}
                   alt={activeIso}
                   style={{ width: 40, height: 26, borderRadius: 3, objectFit: 'cover' }}
                 />
               )}
               <div style={{ fontSize: 18, fontWeight: 600, color: '#f8fafc' }}>
                 {pairData.labelIndex.get(activeIso)?.name || activeIso}
               </div>
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, padding: '0 16px 16px' }}>
            {leaderboardData.blue.length > 0 && (
              <div style={{ marginTop: 16 }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                   <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4494ff' }} />
                   <div style={{ fontSize: 13, fontWeight: 600, color: '#bfdbfe' }}>
                     Ego Talks More
                   </div>
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                   {leaderboardData.blue.map(item => (
                     <div key={item.iso} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                       {/* Ego Flag (Small) */}
                       {activeIso.length === 2 && (
                         <img src={`https://flagcdn.com/w20/${activeIso.toLowerCase()}.png`} alt={activeIso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover', opacity: 0.8 }} />
                       )}
                       
                       {/* Bar */}
                       <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                           <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.1)' }}>
                               <div style={{ flex: item.egoToPartner, background: '#4494ff' }} />
                               <div style={{ flex: item.partnerToEgo, background: '#f97316' }} />
                           </div>
                           <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 2, color: '#94a3b8', lineHeight: 1 }}>
                               <span style={{ color: '#93c5fd' }}>{item.egoToPartner.toLocaleString()}</span>
                               <span style={{ color: '#fdba74' }}>{item.partnerToEgo.toLocaleString()}</span>
                           </div>
                       </div>

                       {/* Target Info */}
                       <div style={{ width: 80, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                           <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', maxWidth: 50 }}>{item.name}</div>
                           {item.iso.length === 2 && (
                             <img src={`https://flagcdn.com/w20/${item.iso.toLowerCase()}.png`} alt={item.iso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover' }} />
                           )}
                       </div>
                     </div>
                   ))}
                 </div>
              </div>
            )}

            {leaderboardData.purple.length > 0 && (
              <div style={{ marginTop: 20 }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                   <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#9333ea' }} />
                   <div style={{ fontSize: 13, fontWeight: 600, color: '#d8b4fe' }}>
                     Roughly Equal Coverage
                   </div>
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                   {leaderboardData.purple.map(item => (
                     <div key={item.iso} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                       {/* Ego Flag (Small) */}
                       {activeIso.length === 2 && (
                         <img src={`https://flagcdn.com/w20/${activeIso.toLowerCase()}.png`} alt={activeIso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover', opacity: 0.8 }} />
                       )}
                       
                       {/* Bar */}
                       <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                           <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.1)' }}>
                               <div style={{ flex: item.egoToPartner, background: '#9333ea' }} />
                               <div style={{ flex: item.partnerToEgo, background: '#9333ea' }} />
                           </div>
                           <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 2, color: '#94a3b8', lineHeight: 1 }}>
                               <span style={{ color: '#d8b4fe' }}>{item.egoToPartner.toLocaleString()}</span>
                               <span style={{ color: '#d8b4fe' }}>{item.partnerToEgo.toLocaleString()}</span>
                           </div>
                       </div>

                       {/* Target Info */}
                       <div style={{ width: 80, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                           <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', maxWidth: 50 }}>{item.name}</div>
                           {item.iso.length === 2 && (
                             <img src={`https://flagcdn.com/w20/${item.iso.toLowerCase()}.png`} alt={item.iso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover' }} />
                           )}
                       </div>
                     </div>
                   ))}
                 </div>
              </div>
            )}

            {leaderboardData.orange.length > 0 && (
              <div style={{ marginTop: 20 }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                   <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316' }} />
                   <div style={{ fontSize: 13, fontWeight: 600, color: '#fdba74' }}>
                     Target Talks More
                   </div>
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                   {leaderboardData.orange.map(item => (
                     <div key={item.iso} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                       {/* Ego Flag (Small) */}
                       {activeIso.length === 2 && (
                         <img src={`https://flagcdn.com/w20/${activeIso.toLowerCase()}.png`} alt={activeIso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover', opacity: 0.8 }} />
                       )}
                       
                       {/* Bar */}
                       <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                           <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.1)' }}>
                               <div style={{ flex: item.egoToPartner, background: '#4494ff' }} />
                               <div style={{ flex: item.partnerToEgo, background: '#f97316' }} />
                           </div>
                           <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 2, color: '#94a3b8', lineHeight: 1 }}>
                               <span style={{ color: '#93c5fd' }}>{item.egoToPartner.toLocaleString()}</span>
                               <span style={{ color: '#fdba74' }}>{item.partnerToEgo.toLocaleString()}</span>
                           </div>
                       </div>

                       {/* Target Info */}
                       <div style={{ width: 80, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                           <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', maxWidth: 50 }}>{item.name}</div>
                           {item.iso.length === 2 && (
                             <img src={`https://flagcdn.com/w20/${item.iso.toLowerCase()}.png`} alt={item.iso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover' }} />
                           )}
                       </div>
                     </div>
                   ))}
                 </div>
              </div>
            )}

            {!leaderboardData.blue.length && !leaderboardData.purple.length && !leaderboardData.orange.length && (
              <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                No relationships found meeting the current criteria.
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', top: 12, left: 12, width: 280, padding: '12px', background: 'rgba(15,23,42,0.85)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontSize: 13 }}>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>Focus country</div>
        <div style={{ marginTop: 4, fontSize: 16, fontWeight: 600, color: '#AFC7FF' }}>{focusLabel}</div>
        <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>Hover to preview connections, click to pin/unpin.</div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 4 }}>
            <button
              onClick={() => setIsGlobe(false)}
              style={{
                flex: 1,
                padding: '6px 0',
                borderRadius: 6,
                border: 'none',
                background: !isGlobe ? 'rgba(68,148,255,0.2)' : 'transparent',
                color: !isGlobe ? '#60a5fa' : '#94a3b8',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Flat
            </button>
            <button
              onClick={() => setIsGlobe(true)}
              style={{
                flex: 1,
                padding: '6px 0',
                borderRadius: 6,
                border: 'none',
                background: isGlobe ? 'rgba(68,148,255,0.2)' : 'transparent',
                color: isGlobe ? '#60a5fa' : '#94a3b8',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Globe
            </button>
        </div>

        <label style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#cbd5e1' }}>
          <input type="checkbox" checked={aggregateAllTime} onChange={e => setAggregateAllTime(e.target.checked)} />
          Aggregate across all years
        </label>
        <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
          {aggregateAllTime ? 'Aggregated view' : 'Dominant mention year'}
        </div>
        <div style={{ marginTop: 4, fontSize: 16, fontWeight: 600, color: '#AFC7FF' }}>{arcSummary.year ?? '—'}</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          <button
            onClick={() => setArcYearIndex(i => (i + arcYears.length - 1) % arcYears.length)}
            disabled={aggregateAllTime || !arcYears.length}
            style={{ flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#cbd5e1', cursor: aggregateAllTime || !arcYears.length ? 'not-allowed' : 'pointer' }}
          >
            Prev
          </button>
          <button
            onClick={() => setArcYearIndex(i => (i + 1) % arcYears.length)}
            disabled={aggregateAllTime || !arcYears.length}
            style={{ flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#cbd5e1', cursor: aggregateAllTime || !arcYears.length ? 'not-allowed' : 'pointer' }}
          >
            Next
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>Min source share ({(arcMinShare * 100).toFixed(1)}%)</div>
        <input 
            type="range" 
            min="0" 
            max="0.2" 
            step="0.005" 
            value={arcMinShare} 
            onChange={e => setArcMinShare(Number(e.target.value))}
            onPointerUp={() => { /* Force update if needed, though React state should handle it */ }} 
            style={{ width: '100%' }} 
        />
        <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>Max arrows ({arcSummary.shown.toLocaleString()} / {arcSummary.available.toLocaleString()})</div>
        <input 
            type="range" 
            min="50" 
            max={ARC_MAX_SEGMENTS} 
            step="10" 
            value={arcMaxVisible} 
            onChange={e => setArcMaxVisible(Number(e.target.value))} 
            style={{ width: '100%' }} 
        />

        <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>Legend</div>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 18, height: 6, borderRadius: 9999, background: 'linear-gradient(90deg, rgba(249,115,22,0.4), rgba(249,115,22,1))' }} />
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>Target talks more</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 18, height: 6, borderRadius: 9999, background: 'linear-gradient(90deg, rgba(147,51,234,0.4), rgba(147,51,234,1))' }} />
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>Coverage roughly equal</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 18, height: 6, borderRadius: 9999, background: 'linear-gradient(90deg, rgba(68,148,255,0.4), rgba(68,148,255,1))' }} />
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>Ego talks more</span>
          </div>
        </div>
      </div>
    </div>
  );
}
