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
  const [vizMode, setVizMode] = useState('arcs'); // 'arcs' | 'columns'
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({
    blue: true,
    green: false,
    purple: false,
    orange: false
  });
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
                transitionDuration: 800,
                transitionInterpolator: new FlyToInterpolator(),
                padding: { bottom: 400 }
            }));

            // 2. Zoom out after glide
            timeoutRef.current = setTimeout(() => {
                setViewState(prev => ({
                    ...prev,
                    zoom: 1.0,
                    latitude: 20,
                    transitionDuration: 800,
                    transitionInterpolator: new FlyToInterpolator()
                }));
            }, 1000);
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
      zoom: 0.6,
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

    // First pass to identify all countries that act as sources (Egos)
    // We need this to differentiate Ego countries from pure Target countries
    const validEgoSet = new Set();
    for (const entry of arcData) {
        if (entry.source_country) validEgoSet.add(entry.source_country.toUpperCase());
    }

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
      
      // Calculate Total Source Mentions for this entry to allow share re-calculation
      const entryTotalMentions = mentions / (Number(entry.mention_share) || 1);

      const key = [sourceIso, targetIso].sort().join('--');
      let record = directionMap.get(key);
      if (!record) {
        record = { isoA: sourceIso < targetIso ? sourceIso : targetIso, isoB: sourceIso < targetIso ? targetIso : sourceIso, rows: {} };
        directionMap.set(key, record);
      }
      
      if (!record.rows[sourceIso]) {
          record.rows[sourceIso] = {
            year: aggregateAllTime ? 'All years' : entryYear,
            source_country: sourceIso,
            target_country: targetIso,
            sourceName: sourceLabel.name,
            targetName: targetLabel.name,
            sourcePosition: [sourceLabel.lon, sourceLabel.lat],
            targetPosition: [targetLabel.lon, targetLabel.lat],
            mention_occurrences: mentions,
            article_hits: Number(entry.article_hits) || 0,
            // Store accumulator for denominator
            _totalSourceMentions: entryTotalMentions,
            mention_share: Number(entry.mention_share) || 0
          };
      } else {
          // Aggregate!
          const existing = record.rows[sourceIso];
          existing.mention_occurrences += mentions;
          existing.article_hits += (Number(entry.article_hits) || 0);
          existing._totalSourceMentions += entryTotalMentions;
          // Recalculate share
          existing.mention_share = existing.mention_occurrences / Math.max(existing._totalSourceMentions, 1);
      }
    }

    const pairs = [];
    directionMap.forEach(record => {
      pairs.push(record);
    });
    return { pairs, year: selectedYear ?? 'All years', labelIndex, allSourceIsos: Array.from(allSourceIsos), sourceCounts, validEgoSet };
  }, [landData, arcData, arcYears, arcYearIndex, aggregateAllTime, countryLabels]);

  const activeIso = selectedBubbleIso;

  const INFO_SVG = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
  );

  // Calculate available countries for bubbles
  const availableCountries = useMemo(() => {
    if (!pairData.allSourceIsos || !pairData.labelIndex) return [];
    
    // We want to show ALL countries that appear in the dataset, not just sources?
    // The previous logic only showed `allSourceIsos`.
    // If the user wants to visually distinguish "Target only", we might need to include them?
    // But the BubbleSelector is for SELECTING an Ego. 
    // You cannot select a pure Target as an Ego because it has no outbound links.
    // So for the selector, we probably still only want valid Egos.
    
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
        .filter(c => c.hasLabel); 
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
      // egoToPartner = Mentions FROM activeIso TO otherIso
      // partnerToEgo = Mentions FROM otherIso TO activeIso
      // The 'activeIso' is our Ego.
      
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
      
      // Ratio Logic: Always Ego / Partner
      // If Ego mentions Partner 100 times, and Partner mentions Ego 10 times.
      // egoToPartner = 100
      // partnerToEgo = 10
      // Ratio = 10.0
      
      // If Ego mentions Partner 10 times, and Partner mentions Ego 100 times.
      // egoToPartner = 10
      // partnerToEgo = 100
      // Ratio = 0.1
      
      const egoToPartner = activeRow?.mention_occurrences || 0;
      const partnerToEgo = otherRow?.mention_occurrences || 0;
      const trueRatio = egoToPartner / Math.max(partnerToEgo, 1);

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
        // Store raw counts for accurate tooltip and ratio logic
        ego_mentions: egoToPartner,
        partner_mentions: partnerToEgo,
        total_articles: totalArticles,
        ratio: trueRatio, // Use the Ego/Partner ratio consistently everywhere
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
  const GREEN_COLOR = [118, 185, 98]; // Green for Ego -> Passive Target

  const colorFromShareRatio = (ratio, targetIso) => {
    // Check if target is a "Passive Target" (cannot be an ego)
    const isPassiveTarget = targetIso && pairData.validEgoSet && !pairData.validEgoSet.has(targetIso);
    
    // If it is a passive target, and the ratio indicates Ego dominance (which it usually will, since passive has 0 outbound)
    // we use Green.
    // Note: Ratio is Ego/Partner. If Partner has 0 mentions, ratio is huge.
    if (isPassiveTarget && ratio > 1.0) return GREEN_COLOR;

    if (!Number.isFinite(ratio)) return BLUE_COLOR; // Default fallback
    
    if (ratio > 1.5) return BLUE_COLOR;
    if (ratio < 0.6666) return ORANGE_COLOR;
    return PURPLE_COLOR;
  };

  const arcLayer = useMemo(() => {
    // Always render arc layer if we have rows, let the transition prop handle the visual "growth"
    if (!visibleRows.length || vizMode === 'columns') return null;
    return new ArcLayer({
      id: 'net-arcs',
      data: visibleRows,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      greatCircle: true,
      wrapLongitude: true,
      getSourcePosition: d => d.sourcePosition,
      getTargetPosition: d => d.targetPosition,
      getSourceColor: d => [...colorFromShareRatio(d.ratio, d.target_country), ARC_FIXED_ALPHA],
      getTargetColor: d => [...colorFromShareRatio(d.ratio, d.target_country), ARC_FIXED_ALPHA],
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
    if (!visibleRows.length || !arcsVisible || vizMode === 'columns') return null;
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
    if (!visibleRows.length || !arcsVisible || vizMode === 'columns') return null;
    return new IconLayer({
      id: 'direction-arrows',
      data: visibleRows,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      getIcon: () => ARROW_ICON,
      sizeUnits: 'meters',
      sizeScale: 5000,
      getPosition: d => d.targetPosition,
      getAngle: d => d.bearing,
      getColor: d => [...colorFromShareRatio(d.ratio, d.target_country), 220],
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

    // Pre-calculate colors and stats map
    const isoStats = new Map();
    let maxMentions = 0;

    if (activeIso) isoStats.set(activeIso, { color: [255, 255, 255, 255], count: 0 }); // White for Ego

    for (const row of visibleRows) {
        const partnerIso = row.source_country === activeIso ? row.target_country : row.source_country;
        // const baseColor = colorFromShareRatio(row.ratio, row.target_country); // Disabled colored fills per user request
        const count = row.mention_occurrences || 0;
        if (count > maxMentions) maxMentions = count;
        
        isoStats.set(partnerIso, { 
            color: [80, 90, 110, 255], // Neutral/Default color
            count
        });
    }

    // Height scale: Max height around 500km-1000km for visibility on globe
    const MAX_ELEVATION = 1000000; 
    const elevationScale = maxMentions > 0 ? MAX_ELEVATION / maxMentions : 0;

    return new GeoJsonLayer({
      id: 'active-countries',
      data: features,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      filled: true,
      stroked: true,
      extruded: vizMode === 'columns',
      wireframe: true,
      getFillColor: f => {
         const props = f.properties || {};
         const iso = (props.ISO_A2 || props.iso_a2 || props.ISO_A2_EH || '').toUpperCase();
         return isoStats.get(iso)?.color || [80, 90, 110, 255];
      },
      getLineColor: [255, 255, 255, 100],
      getElevation: f => {
          if (vizMode !== 'columns') return 0;
          const props = f.properties || {};
          const iso = (props.ISO_A2 || props.iso_a2 || props.ISO_A2_EH || '').toUpperCase();
          const count = isoStats.get(iso)?.count || 0;
          // Use sqrt for better visual distribution of heights
          return Math.sqrt(count) * (maxMentions > 0 ? MAX_ELEVATION / Math.sqrt(maxMentions) : 0);
      },
      lineWidthMinPixels: 1,
      pickable: true,
      parameters: { depthTest: true },
      transitions: {
          getElevation: {
              duration: 1000,
              enter: () => 0
          },
          getFillColor: {
              duration: 1000,
              enter: () => [0, 0, 0, 0]
          }
      },
      updateTriggers: {
          getFillColor: [activeIso, visibleRows, vizMode],
          getElevation: [activeIso, visibleRows, vizMode],
          extruded: [vizMode]
      }
    });
  }, [landData, visibleRows, visibleIsos, activeIso, pairData.validEgoSet, vizMode]);

  const layers = useMemo(
    () => {
      // Order matters: Background must be first to write to depth buffer for occlusion
      return [backgroundLayer, landLayer, activeCountriesLayer, arcLayer, arcNodeLayer, arrowLayer].filter(Boolean);
    },
    [backgroundLayer, landLayer, activeCountriesLayer, arcLayer, arcNodeLayer, arrowLayer]
  );

  const deckTooltip = ({ object, layer }) => {
    if (!object) return null;
    
    // Handle Active Countries Layer Tooltip
    if (layer?.id === 'active-countries') {
        const props = object.properties || {};
        const iso = (props.ISO_A2 || props.iso_a2 || props.ISO_A2_EH || '').toUpperCase();
        const name = props.ADMIN || props.NAME || iso;
        const isEgo = pairData.validEgoSet?.has(iso);
        
        let typeLabel = "Global Actor";
        if (iso === activeIso) typeLabel = "Current Focus (Ego)";
        else if (!isEgo) typeLabel = "Passive Target (No Articles)";
        else typeLabel = "Active Source";
        
        return {
            html: `
            <div style="font-weight:600; font-size:14px">${name}</div>
            <div style="font-size:12px; color:#aaa; margin-top:2px">${typeLabel}</div>
            `
        };
    }

    if (layer?.id !== 'net-arcs') return null;
    
    // Use the stored raw counts for tooltip
    const egoMentions = object.ego_mentions || 0;
    const partnerMentions = object.partner_mentions || 0;
    
    const sharePct = ((object.mention_share || 0) * 100).toFixed(2);
    const ratio = object.ratio ? object.ratio.toFixed(2) : '—';
    
    // Clarify direction for tooltip
    // "Outbound": Ego -> Others (Ego dominates)
    // "Inbound": Others -> Ego (Others dominate)
    // BUT the counts are what matters.
    
    return {
      html: `
        <div style="font-weight:600; font-size:14px; margin-bottom:4px; border-bottom:1px solid #444; padding-bottom:4px">${object.sourceName} → ${object.targetName}</div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px"><span style="color:#aaa">Year:</span><span style="color:#eee; margin-left:8px">${object.year ?? '—'}</span></div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px"><span style="color:#aaa">Ego mentions Target:</span><span style="color:#eee; margin-left:8px">${Number(egoMentions).toLocaleString()}</span></div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px"><span style="color:#aaa">Target mentions Ego:</span><span style="color:#eee; margin-left:8px">${Number(partnerMentions).toLocaleString()}</span></div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px"><span style="color:#aaa">Total articles:</span><span style="color:#eee; margin-left:8px">${Number(object.total_articles || 0).toLocaleString()}</span></div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px"><span style="color:#aaa">Share:</span><span style="color:#eee; margin-left:8px">${sharePct}%</span></div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px"><span style="color:#aaa">Ratio (Ego/Target):</span><span style="color:#eee; margin-left:8px">${ratio}</span></div>`
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
    const purple = []; 
    const green = []; // New category for Ego -> Passive Target

    for (const row of visibleRows) {
      const isOutbound = row.direction === 'outbound';
      const partnerIso = isOutbound ? row.target_country : row.source_country;
      const partnerName = isOutbound ? row.targetName : row.sourceName;
      
      const egoToPartner = isOutbound ? row.mention_occurrences : row.counterpart_mentions;
      const partnerToEgo = isOutbound ? row.counterpart_mentions : row.mention_occurrences;
      
      const ratio = egoToPartner / Math.max(partnerToEgo, 1);
      const isPassiveTarget = pairData.validEgoSet && !pairData.validEgoSet.has(partnerIso);
      
      const item = {
        iso: partnerIso,
        name: partnerName,
        egoToPartner,
        partnerToEgo,
        total: egoToPartner + partnerToEgo,
        isPassiveTarget
      };

      if (isPassiveTarget) {
          // If partner is passive, it means they CANNOT have significant outbound flow.
          // So it will almost always be ego-dominated.
          green.push(item);
      } else if (ratio >= 0.6666 && ratio <= 1.5) {
          purple.push(item);
      } else if (isOutbound) {
          blue.push(item);
      } else {
          orange.push(item);
      }
    }
    return {
      blue: blue.sort((a, b) => b.egoToPartner - a.egoToPartner).slice(0, 20),
      orange: orange.sort((a, b) => b.partnerToEgo - a.partnerToEgo).slice(0, 20),
      purple: purple.sort((a, b) => b.total - a.total).slice(0, 20),
      green: green.sort((a, b) => b.egoToPartner - a.egoToPartner).slice(0, 20)
    };
  }, [activeIso, visibleRows, pairData.validEgoSet]);

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
        controller: { 
            dragPan: true, 
            scrollZoom: { speed: 1.0, smooth: true }, 
            touchZoom: true, 
            doubleClickZoom: true, 
            keyboard: false, 
            inertia: 100 
        },
        resolution: 10,
        nearZMultiplier: 0.003,
        farZMultiplier: 30
      });
    }
    return new MapView({ 
        id: 'map', 
        controller: {
            dragPan: true,
            scrollZoom: { speed: 1.0, smooth: true },
            touchZoom: true,
            doubleClickZoom: true,
            keyboard: false,
            inertia: 100
        }, 
        wrapLongitude: true 
    });
  }, [isGlobe]);

  const handleViewStateChange = ({ viewState: vs, interactionState }) => {
    // Strip transition properties to prevent "fighting" / glitches during interaction
    // caused by active transitions (e.g. from useEffect) persisting into the drag/zoom state.
    // This is critical for smooth zooming when hovering interactive elements.
    const { transitionDuration, transitionInterpolator, transitionEasing, ...rest } = vs;

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
      const nextState = { ...rest };
      if (interactionState && interactionState.isDragging) {
          nextState.latitude = 20; 
      }
      nextState.padding = { bottom: 400 };
      setViewState(nextState);
    } else {
      // For flat map, ensure we respect the incoming viewState fully to handle cursor-based zoom
      setViewState({ ...rest, padding: { bottom: 400 } });
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
    const topGreen = leaderboardData.green[0];

    // Calculate Top 10 Talked About (Outbound Mentions)
    // Combine Blue (Ego More), Green (Passive), and Purple (Equal)
    // We care about who the Ego talks about the most.
    const allOutbound = [
        ...leaderboardData.blue,
        ...leaderboardData.green,
        ...leaderboardData.purple
    ].sort((a, b) => b.egoToPartner - a.egoToPartner).slice(0, 8);
    
    let headline = "Global Mentions Analysis";
    let subhead = "Hover over a country to see details";
    let countryName = pairData.labelIndex.get(activeIso)?.name || activeIso;

    // Calculate date string for subtitle
    let dateRange = "";
    if (aggregateAllTime) {
        if (arcYears.length > 0) {
            const minYear = Math.min(...arcYears);
            const maxYear = Math.max(...arcYears);
            dateRange = minYear === maxYear ? `${minYear}` : `${minYear}-${maxYear}`;
        } else {
            dateRange = "All years";
        }
    } else {
        // If not aggregated, use the current selected year
        // Note: pairData.year is 'All years' if aggregateAllTime is true, else specific year
        dateRange = `${pairData.year}`;
    }

    if (topGreen) {
      headline = `${countryName.toUpperCase()} TALKS ABOUT ${topGreen.name.toUpperCase()}`;
      subhead = `${topGreen.egoToPartner.toLocaleString()} times from ${dateRange}!`;
    } else if (topBlue) {
      headline = `${countryName.toUpperCase()} DISCUSSES ${topBlue.name.toUpperCase()}`;
      subhead = `${topBlue.egoToPartner.toLocaleString()} times from ${dateRange}!`;
    } else if (topOrange) {
      headline = `${countryName.toUpperCase()} IN THE NEWS`;
      subhead = `${topOrange.partnerToEgo.toLocaleString()} times from ${dateRange}!`;
    } else {
      headline = `${countryName.toUpperCase()} PERSPECTIVE`;
      subhead = "Exploring global connections";
    }

    return { headline, subhead, countryName, topMentions: allOutbound, leaderboardData };
  }, [leaderboardData, activeIso, pairData, arcYears, aggregateAllTime]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {newspaperProps && (
        <NewspaperOverlay 
          headline={newspaperProps.headline} 
          subhead={newspaperProps.subhead} 
          countryName={newspaperProps.countryName}
          topMentions={newspaperProps.topMentions}
          leaderboardData={newspaperProps.leaderboardData}
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

      {showInfoModal && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200
        }} onClick={() => setShowInfoModal(false)}>
          <div style={{
            width: 600,
            maxHeight: '80vh',
            overflowY: 'auto',
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            padding: 32,
            color: '#e2e8f0',
            position: 'relative',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }} onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setShowInfoModal(false)}
              style={{ position: 'absolute', top: 20, right: 20, background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 24 }}
            >
              ×
            </button>
            <h2 style={{ marginTop: 0, fontSize: 24, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 16 }}>About Global Gossip</h2>
            
            <p style={{ lineHeight: 1.6, color: '#cbd5e1', fontSize: 15 }}>
              <strong>Global Gossip</strong> visualizes the flow of international attention by analyzing millions of news articles. It reveals not just who is talking, but who they are talking <em>about</em>—highlighting the often asymmetrical nature of global discourse.
            </p>

            <h3 style={{ color: '#fff', marginTop: 24, fontSize: 18 }}>How It Works</h3>
            <p style={{ lineHeight: 1.6, color: '#cbd5e1', fontSize: 15 }}>
              We process a massive corpus of global news to extract "Cross-Country Mentions." The core challenge is correctly identifying when a country is mentioned, regardless of the language used in the article.
            </p>

            <h4 style={{ color: '#e2e8f0', marginTop: 16, fontSize: 16 }}>Multilingual Entity Extraction</h4>
            <p style={{ lineHeight: 1.6, color: '#cbd5e1', fontSize: 15 }}>
              To ensure our analysis isn't English-centric, we utilize the <strong>Common Locale Data Repository (CLDR)</strong>. For every "Ego" (source) country, we build a dynamic dictionary that includes:
            </p>
            <ul style={{ lineHeight: 1.6, color: '#cbd5e1', paddingLeft: 20, fontSize: 15 }}>
              <li><strong>Native Names:</strong> The target country's name in the Ego country's primary language(s).</li>
              <li><strong>Formal & Informal Variants:</strong> e.g., "United States," "USA," "US," "America."</li>
              <li><strong>Lingua Franca Support:</strong> English names are always included to capture international usages.</li>
            </ul>
            <p style={{ lineHeight: 1.6, color: '#cbd5e1', fontSize: 15 }}>
              We use <code>flashtext</code>, a high-performance keyword search algorithm, to scan articles and count these mentions. This allows us to map, for example, how often French newspapers mention "Allemagne" (Germany) or how often Chinese outlets mention "美国" (USA).
            </p>

            <h3 style={{ color: '#fff', marginTop: 24, fontSize: 18 }}>Exploration Guide</h3>
            <p style={{ lineHeight: 1.6, color: '#cbd5e1', fontSize: 15 }}>
              Use the visualization to explore different types of relationships:
            </p>
            <ul style={{ lineHeight: 1.6, color: '#cbd5e1', paddingLeft: 20, fontSize: 15 }}>
              <li><strong>"Rent Free" (Blue):</strong> Countries the Ego talks about significantly more than they are talked about in return.</li>
              <li><strong>Reciprocal (Purple):</strong> Balanced relationships where both sides mention each other roughly equally.</li>
              <li><strong>Passive Targets (Green):</strong> Countries that are frequently mentioned but do not have articles in our dataset (e.g., conflict zones or smaller nations).</li>
            </ul>
          </div>
        </div>
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
            width: 380, // Increased from 320
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
                 <div 
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}
                    onClick={() => setExpandedGroups(prev => ({ ...prev, blue: !prev.blue }))}
                 >
                   <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4494ff' }} />
                   <div style={{ fontSize: 13, fontWeight: 600, color: '#bfdbfe', flex: 1 }}>
                     Countries that live 'rent free' in {pairData.labelIndex.get(activeIso)?.name || activeIso}'s head
                   </div>
                   <div style={{ fontSize: 10, color: '#64748b' }}>{expandedGroups.blue ? '▼' : '▶'}</div>
                 </div>
                 {expandedGroups.blue && (
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
                           <div style={{ width: 120, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                               <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', maxWidth: 90 }}>{item.name}</div>
                               {item.iso.length === 2 && (
                                 <img src={`https://flagcdn.com/w20/${item.iso.toLowerCase()}.png`} alt={item.iso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover' }} />
                               )}
                           </div>
                         </div>
                       ))}
                     </div>
                 )}
              </div>
            )}

            {leaderboardData.green.length > 0 && (
              <div style={{ marginTop: 16 }}>
                 <div 
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}
                    onClick={() => setExpandedGroups(prev => ({ ...prev, green: !prev.green }))}
                 >
                   <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#76b962' }} />
                   <div style={{ fontSize: 13, fontWeight: 600, color: '#86efac', flex: 1 }}>
                     Mentions of countries not in dataset
                   </div>
                   <div style={{ fontSize: 10, color: '#64748b' }}>{expandedGroups.green ? '▼' : '▶'}</div>
                 </div>
                 {expandedGroups.green && (
                     <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                       {leaderboardData.green.map(item => (
                         <div key={item.iso} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                           {activeIso.length === 2 && (
                             <img src={`https://flagcdn.com/w20/${activeIso.toLowerCase()}.png`} alt={activeIso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover', opacity: 0.8 }} />
                           )}
                           
                           <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                               <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.1)' }}>
                                   <div style={{ flex: item.egoToPartner, background: '#76b962' }} />
                                   <div style={{ flex: item.partnerToEgo, background: '#f97316' }} />
                               </div>
                               <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 2, color: '#94a3b8', lineHeight: 1 }}>
                                   <span style={{ color: '#86efac' }}>{item.egoToPartner.toLocaleString()}</span>
                                   <span style={{ color: '#fdba74' }}>{item.partnerToEgo.toLocaleString()}</span>
                               </div>
                           </div>

                           <div style={{ width: 80, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                               <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', maxWidth: 50 }}>{item.name}</div>
                               {item.iso.length === 2 && (
                                 <img src={`https://flagcdn.com/w20/${item.iso.toLowerCase()}.png`} alt={item.iso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover' }} />
                               )}
                           </div>
                         </div>
                       ))}
                     </div>
                 )}
              </div>
            )}

            {leaderboardData.purple.length > 0 && (
              <div style={{ marginTop: 20 }}>
                 <div 
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}
                    onClick={() => setExpandedGroups(prev => ({ ...prev, purple: !prev.purple }))}
                 >
                   <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#9333ea' }} />
                   <div style={{ fontSize: 13, fontWeight: 600, color: '#d8b4fe', flex: 1 }}>
                     Roughly Equal Coverage
                   </div>
                   <div style={{ fontSize: 10, color: '#64748b' }}>{expandedGroups.purple ? '▼' : '▶'}</div>
                 </div>
                 {expandedGroups.purple && (
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
                           <div style={{ width: 120, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                               <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', maxWidth: 90 }}>{item.name}</div>
                               {item.iso.length === 2 && (
                                 <img src={`https://flagcdn.com/w20/${item.iso.toLowerCase()}.png`} alt={item.iso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover' }} />
                               )}
                           </div>
                         </div>
                       ))}
                     </div>
                 )}
              </div>
            )}

            {leaderboardData.orange.length > 0 && (
              <div style={{ marginTop: 20 }}>
                 <div 
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}
                    onClick={() => setExpandedGroups(prev => ({ ...prev, orange: !prev.orange }))}
                 >
                   <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316' }} />
                   <div style={{ fontSize: 13, fontWeight: 600, color: '#fdba74', flex: 1 }}>
                     {pairData.labelIndex.get(activeIso)?.name || activeIso} lives 'rent free' in these countries' heads
                   </div>
                   <div style={{ fontSize: 10, color: '#64748b' }}>{expandedGroups.orange ? '▼' : '▶'}</div>
                 </div>
                 {expandedGroups.orange && (
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
                           <div style={{ width: 120, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                               <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', maxWidth: 90 }}>{item.name}</div>
                               {item.iso.length === 2 && (
                                 <img src={`https://flagcdn.com/w20/${item.iso.toLowerCase()}.png`} alt={item.iso} style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover' }} />
                               )}
                           </div>
                         </div>
                       ))}
                     </div>
                 )}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Focus country</div>
            <button
                onClick={() => setShowInfoModal(true)}
                style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
                title="About this visualization"
            >
                {INFO_SVG}
            </button>
        </div>
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

        {/* Viz Mode Toggle - Hidden for now
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 4 }}>
            <button
              onClick={() => setVizMode('arcs')}
              style={{
                flex: 1,
                padding: '6px 0',
                borderRadius: 6,
                border: 'none',
                background: vizMode === 'arcs' ? 'rgba(68,148,255,0.2)' : 'transparent',
                color: vizMode === 'arcs' ? '#60a5fa' : '#94a3b8',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Arcs
            </button>
            <button
              onClick={() => setVizMode('columns')}
              style={{
                flex: 1,
                padding: '6px 0',
                borderRadius: 6,
                border: 'none',
                background: vizMode === 'columns' ? 'rgba(68,148,255,0.2)' : 'transparent',
                color: vizMode === 'columns' ? '#60a5fa' : '#94a3b8',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Columns
            </button>
        </div>
        */}

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
            <span style={{ width: 18, height: 6, borderRadius: 9999, background: 'linear-gradient(90deg, rgba(118,185,98,0.4), rgba(118,185,98,1))' }} />
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>Target mentioned, but not in dataset</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 18, height: 6, borderRadius: 9999, background: 'linear-gradient(90deg, rgba(249,115,22,0.4), rgba(249,115,22,1))' }} />
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>Target mentions ego more</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 18, height: 6, borderRadius: 9999, background: 'linear-gradient(90deg, rgba(147,51,234,0.4), rgba(147,51,234,1))' }} />
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>Coverage roughly equal</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 18, height: 6, borderRadius: 9999, background: 'linear-gradient(90deg, rgba(68,148,255,0.4), rgba(68,148,255,1))' }} />
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>Ego mentions target more</span>
          </div>
        </div>
      </div>
    </div>
  );
}
