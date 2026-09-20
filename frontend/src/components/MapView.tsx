import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Neighborhood, Warehouse, Assignment, BasemapStyle, ColorByMode, ZoneColorMap } from '../types';
import { BASEMAPS, getMapboxToken, colorForZone, zoneCounts } from './mapThemes';
import type { CoverageBounds, CoverageCell, IsoFeature } from '../services/api';

const PALETTE = ['#0ea5e9', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1'];

function whColor(warehouseId: string): string {
  const n = parseInt(warehouseId.replace(/\D/g, '') || '1', 10);
  return PALETTE[(n - 1) % PALETTE.length];
}

/** Corridor congestion → traffic-light color for route lines. */
export function congestionColor(delayRatio: number): string {
  if (delayRatio < 0.15) return '#22c55e';
  if (delayRatio < 0.4) return '#f59e0b';
  return '#ef4444';
}

function demandColor(orders: number, minOrders: number, maxOrders: number): { color: string; category: string } {
  const ratio = maxOrders <= minOrders ? 0.5 : Math.max(0, Math.min(1, (orders - minOrders) / (maxOrders - minOrders)));
  if (ratio >= 0.66) return { color: '#ef4444', category: 'High' };
  if (ratio >= 0.33) return { color: '#f59e0b', category: 'Medium' };
  return { color: '#0ea5e9', category: 'Low' };
}

/** Approximate a geodesic circle as a GeoJSON polygon (no extra deps). */
function circlePolygon(lat: number, lon: number, radiusKm: number, steps = 64): number[][][] {
  const R = 6371;
  const d = radiusKm / R;
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(brng)
    );
    const lon2 =
      lonR +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(latR),
        Math.cos(d) - Math.sin(latR) * Math.sin(lat2)
      );
    ring.push([((lon2 * 180) / Math.PI + 540) % 360 - 180, (lat2 * 180) / Math.PI]);
  }
  return [ring];
}

export interface MapFocus {
  lat: number;
  lon: number;
  zoom?: number;
  key: number;
}

interface MapViewProps {
  neighborhoods: Neighborhood[];
  warehouses?: Warehouse[];
  assignments?: Assignment[];
  radiusKm?: number | null;
  height?: number;
  /** Fill parent height instead of fixed pixel height (for full-viewport shells). */
  fill?: boolean;
  basemap: BasemapStyle;
  onBasemapChange: (b: BasemapStyle) => void;
  colorBy: ColorByMode;
  onColorByChange: (c: ColorByMode) => void;
  zoneColors: ZoneColorMap;
  /** Layer visibility toggles (map chips). */
  showWarehouses?: boolean;
  showRoutes?: boolean;
  showDemand?: boolean;
  showRadius?: boolean;
  /** Fly-to request; effect triggers on key change. */
  focus?: MapFocus | null;
  /** Override route polyline color (e.g. pink on dark maps). */
  routeColor?: string;
  /** Color route lines by corridor congestion (green→amber→red) instead of warehouse. */
  colorRoutesByTraffic?: boolean;
  /** Route line rendering: straight displacement (default) or actual road paths. */
  linesMode?: 'displacement' | 'roads';
  /** Traced road paths by neighborhood_id ([[lon, lat], ...]). Missing entries fall back to straight lines. */
  roadGeometries?: Record<string, number[][]>;
  /** Road-network service-area polygons by warehouse_id (Mapbox isochrones).
   * Rendered as the radius heatmap in roads mode; missing entries fall back
   * to straight-line circles. */
  isochrones?: Record<string, IsoFeature[]>;
  /** Click a route line to trace its road path (roads mode, large datasets). */
  onRouteClick?: (neighborhoodId: string) => void;
  /** Phase B (#1): click a warehouse pin to isolate its zone. */
  onWarehouseClick?: (warehouseId: string) => void;
  /** Phase B (#1): isolated warehouse zone — other zones dim/hide. */
  focusedWarehouseId?: string | null;
  /** Phase B (#2): proximity heatmap cells (green near → red far). */
  coverageCells?: CoverageCell[];
  /** City-wide grid geometry (bounds + cell step) for continuous zone polygons. */
  coverageMeta?: { grid_n?: number; bounds?: CoverageBounds; cell_step?: { dlat: number; dlon: number } } | null;
  /** Phase B (#2): heatmap layer visibility. */
  showHeatmap?: boolean;
  /** Heatmap range labels (km) for the legend. */
  coverageRange?: { minKm: number; maxKm: number } | null;
  /** 'light' | 'dark' website theme — adjusts pin chrome. */
  theme?: 'light' | 'dark';
  /** Hide the built-in header/legend chrome (shell provides its own). */
  minimal?: boolean;
  /** Selected neighborhood id to emphasize. */
  highlightId?: string | null;
}

const COLOR_MODES: { id: ColorByMode; label: string }[] = [
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'zone', label: 'Zone' },
  { id: 'demand', label: 'Demand' }
];

const ROUTES_OK = 'gp-routes-ok';
const ROUTES_BAD = 'gp-routes-bad';
const RADIUS_SRC = 'gp-radius';
const HEATMAP_SRC = 'gp-coverage-heat';
const BUILDINGS_LAYER = 'gp-3d-buildings';

/** Default camera: India-wide view for empty accounts (no city assumed). */
const INDIA_CENTER: [number, number] = [78.5, 22.0];
const INDIA_ZOOM = 4;

/** Add (or remove) the 3D building-extrusion layer. Safe to call on any style. */
function sync3DBuildings(map: mapboxgl.Map, enabled: boolean) {
  try {
    if (map.getLayer(BUILDINGS_LAYER)) map.removeLayer(BUILDINGS_LAYER);
  } catch { /* ignore */ }
  if (!enabled) return;
  try {
    const style = map.getStyle();
    if (!style || !(style.sources as Record<string, unknown>).composite) return;
    // Insert below the first label layer so extrusions don't cover place names.
    const labelLayer = style.layers.find(
      (l) => l.type === 'symbol' && (l.layout as Record<string, unknown> | undefined)?.['text-field']
    )?.id;
    map.addLayer(
      {
        id: BUILDINGS_LAYER,
        source: 'composite',
        'source-layer': 'building',
        filter: ['==', 'extrude', 'true'],
        type: 'fill-extrusion',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': '#9aa5b1',
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.05, ['get', 'height']],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.05, ['get', 'min_height']],
          'fill-extrusion-opacity': 0.65
        }
      },
      labelLayer
    );
  } catch { /* style without building source — stay 2D */ }
}

function removeLayerAndSource(map: mapboxgl.Map, layerId: string, sourceId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch { /* ignore */ }
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch { /* ignore */ }
}

export const MapView: React.FC<MapViewProps> = ({
  neighborhoods,
  warehouses = [],
  assignments = [],
  radiusKm = null,
  height = 420,
  fill = false,
  basemap,
  onBasemapChange,
  colorBy,
  onColorByChange,
  zoneColors,
  showWarehouses = true,
  showRoutes = true,
  showDemand = true,
  showRadius = true,
  focus = null,
  routeColor,
  colorRoutesByTraffic = false,
  linesMode = 'displacement',
  roadGeometries = {},
  isochrones = {},
  onRouteClick,
  onWarehouseClick,
  focusedWarehouseId = null,
  coverageCells = [],
  coverageMeta = null,
  showHeatmap = false,
  coverageRange = null,
  theme = 'light',
  minimal = false,
  highlightId = null
}) => {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const routeClickRef = useRef<((id: string) => void) | undefined>(undefined);
  routeClickRef.current = onRouteClick;
  const warehouseClickRef = useRef<((id: string) => void) | undefined>(undefined);
  warehouseClickRef.current = onWarehouseClick;
  const styleRef = useRef<string>('');
  const threeDRef = useRef(false);
  const threeDBtnRef = useRef<HTMLButtonElement | null>(null);
  // Signature of the last fitted layout — auto-fit runs only when the data
  // itself changes, never on UI toggles (sidebar, layers, theme), so the
  // user's pan/zoom is preserved.
  const fittedRef = useRef<{ n: Neighborhood[] | null; w: Warehouse[] | null; a: Assignment[] | null }>({
    n: null,
    w: null,
    a: null
  });
  // Tracks whether the last overlay render had data — used to glide back to
  // the India-wide view when the dataset transitions to empty.
  const wasEmptyRef = useRef(true);
  const [styleReady, setStyleReady] = useState(false);
  const token = getMapboxToken();

  // Create the map once (token must exist)
  useEffect(() => {
    if (!divRef.current || mapRef.current || !token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: divRef.current,
      style: BASEMAPS[basemap].style,
      center: INDIA_CENTER,
      zoom: INDIA_ZOOM,
      maxPitch: 75,
      // Attribution must stay on the map (Mapbox ToS + ODbL) — it is added
      // back below as a compact "(i)" toggle to keep it compliant but subtle.
      attributionControl: false
    });
    styleRef.current = BASEMAPS[basemap].style;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    // Attribution sits bottom-left, right beside the Mapbox wordmark —
    // Mapbox's own CSS mirrors the compact pill for left corners.
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    // One-click 2D ⇄ 3D toggle (pitch + building extrusions). Refs only, so the
    // closure stays valid for the map's lifetime.
    const toggle3D = () => {
      const m = mapRef.current;
      if (!m) return;
      threeDRef.current = !threeDRef.current;
      const on = threeDRef.current;
      if (threeDBtnRef.current) {
        threeDBtnRef.current.textContent = on ? '2D' : '3D';
        threeDBtnRef.current.title = on ? 'Switch back to 2D' : 'Tilt into 3D with buildings';
      }
      try {
        if (on) m.easeTo({ pitch: 62, bearing: -20, duration: 1200 });
        else m.easeTo({ pitch: 0, bearing: 0, duration: 1200 });
      } catch { /* ignore */ }
      if (m.isStyleLoaded()) sync3DBuildings(m, on);
    };
    const container = document.createElement('div');
    container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '3D';
    btn.title = 'Tilt into 3D with buildings';
    // Colors come from .gp-3d-toggle in index.css (explicit per-theme rules —
    // the button must NOT inherit the app's adaptive text color, which goes
    // invisible on the white control surface in dark website mode).
    btn.className = 'gp-3d-toggle';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '800';
    btn.style.width = '30px';
    btn.style.height = '30px';
    btn.setAttribute('aria-label', 'Toggle 3D buildings');
    btn.addEventListener('click', toggle3D);
    container.appendChild(btn);
    threeDBtnRef.current = btn;
    map.addControl(
      {
        onAdd: () => container,
        onRemove: () => {
          container.parentNode?.removeChild(container);
          threeDBtnRef.current = null;
        }
      } as mapboxgl.IControl,
      'bottom-right'
    );

    map.on('load', () => {
      setStyleReady(true);
      sync3DBuildings(map, threeDRef.current);
    });
    // Click a route line to trace its road path (roads mode, large datasets)
    const onLineClick = (e: mapboxgl.MapMouseEvent & { features?: { properties?: Record<string, unknown> }[] }) => {
      const id = e.features?.[0]?.properties?.neighborhood_id;
      if (typeof id === 'string' && routeClickRef.current) routeClickRef.current(id);
    };
    map.on('click', ROUTES_OK, onLineClick);
    map.on('click', ROUTES_BAD, onLineClick);
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      styleRef.current = '';
      setStyleReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Swap Mapbox style when basemap changes (sources re-added by overlay effect)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !token) return;
    const want = BASEMAPS[basemap].style;
    if (styleRef.current === want) return;
    styleRef.current = want;
    setStyleReady(false);
    try {
      map.setStyle(want);
      map.once('idle', () => setStyleReady(true));
    } catch {
      setStyleReady(true);
    }
  }, [basemap, token]);

  // Render overlays: demand bubbles, warehouse pins, radius circles, assignment lines
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !token || !styleReady) return;

    // Empty dataset → glide back to the India-wide view, but only on the
    // transition into empty (never fight the user's pan/zoom while empty).
    const isEmpty = neighborhoods.length === 0 && warehouses.length === 0;
    if (isEmpty) {
      if (!wasEmptyRef.current) {
        wasEmptyRef.current = true;
        try {
          map.easeTo({ center: INDIA_CENTER, zoom: INDIA_ZOOM, duration: 800 });
        } catch { /* ignore */ }
      }
    } else {
      wasEmptyRef.current = false;
    }

    // Clear previous markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    removeLayerAndSource(map, ROUTES_OK, ROUTES_OK);
    removeLayerAndSource(map, ROUTES_BAD, ROUTES_BAD);
    removeLayerAndSource(map, `${HEATMAP_SRC}-zones`, HEATMAP_SRC);
    removeLayerAndSource(map, `${HEATMAP_SRC}-circles`, HEATMAP_SRC);
    removeLayerAndSource(map, `${RADIUS_SRC}-fill`, RADIUS_SRC);
    // (fill + line share one source; remove both layers first)
    try {
      if (map.getLayer(`${RADIUS_SRC}-line`)) map.removeLayer(`${RADIUS_SRC}-line`);
    } catch { /* ignore */ }

    const asgByNb = new Map(assignments.map((a) => [a.neighborhood_id, a]));
    const orders = neighborhoods.map((n) => Number(n.daily_orders) || 0);
    const minOrders = orders.length ? Math.min(...orders) : 0;
    const maxOrders = orders.length ? Math.max(...orders) : 1;
    const bounds = new mapboxgl.LngLatBounds();
    let hasBounds = false;
    const extend = (lat: number, lon: number) => {
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        bounds.extend([lon, lat]);
        hasBounds = true;
      }
    };

    const resolveColor = (n: Neighborhood): { color: string; tag: string } => {
      if (colorBy === 'zone') {
        const z = (n.zone || 'Unzoned').trim() || 'Unzoned';
        return { color: colorForZone(z, zoneColors), tag: z };
      }
      if (colorBy === 'demand') {
        const d = demandColor(Number(n.daily_orders) || 0, minOrders, maxOrders);
        return { color: d.color, tag: `${d.category} demand` };
      }
      const a = asgByNb.get(n.neighborhood_id);
      return { color: a ? whColor(a.warehouse_id) : '#64748b', tag: a ? a.warehouse_id : 'unassigned' };
    };

    const pinBorder = theme === 'dark' ? '#1B1B1F' : '#fff';
    const lineColor = (wid: string) => routeColor || whColor(wid);
    const routePaint = (a: { congestion_pct?: number | null; warehouse_id: string }) =>
      colorRoutesByTraffic && a.congestion_pct != null ? congestionColor(a.congestion_pct) : lineColor(a.warehouse_id);

    // Phase B (#1): focus membership — non-selected zones dim for clarity.
    const focusMembers = focusedWarehouseId
      ? new Set(assignments.filter((a) => a.warehouse_id === focusedWarehouseId).map((a) => a.neighborhood_id))
      : null;
    const inFocus = (nid: string) => !focusMembers || focusMembers.has(nid);

    // City-wide continuous heatmap UNDER bubbles/routes — insert first so
    // route lines and demand bubbles paint over it. Each grid cell renders as
    // a contiguous zone polygon (no gaps, no isolated dots), tiling the full
    // padded service-area bounds from edge to edge.
    if (showHeatmap && coverageCells.length > 0) {
      let dlat = coverageMeta?.cell_step?.dlat;
      let dlon = coverageMeta?.cell_step?.dlon;
      if (!Number.isFinite(dlat as number) || !Number.isFinite(dlon as number)) {
        // Fallback: derive the step from the cell extents when the server
        // payload predates bounds/cell_step.
        const cls = coverageCells.map((c) => c.lat);
        const cns = coverageCells.map((c) => c.lon);
        const nGuess = Math.max(1, Math.round(Math.sqrt(coverageCells.length)));
        dlat = (Math.max(...cls) - Math.min(...cls)) / nGuess || 0.02;
        dlon = (Math.max(...cns) - Math.min(...cns)) / nGuess || 0.02;
      }
      const hl = (dlat as number) / 2;
      const hw = (dlon as number) / 2;
      const feats = coverageCells.map((c) => ({
        type: 'Feature' as const,
        properties: { color: c.color },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [c.lon - hw, c.lat - hl],
            [c.lon + hw, c.lat - hl],
            [c.lon + hw, c.lat + hl],
            [c.lon - hw, c.lat + hl],
            [c.lon - hw, c.lat - hl]
          ]]
        }
      }));
      try {
        map.addSource(HEATMAP_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
        map.addLayer({
          id: `${HEATMAP_SRC}-zones`,
          type: 'fill',
          source: HEATMAP_SRC,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.32
          }
        });
      } catch { /* style race — next render retries */ }
    }

    if (showDemand) {
      neighborhoods.forEach((n) => {
        const a = asgByNb.get(n.neighborhood_id);
        const { color, tag } = resolveColor(n);
        const frac = Math.sqrt((Number(n.daily_orders) || 0) / Math.max(1, maxOrders));
        const isHi = highlightId === n.neighborhood_id;
        const dimmed = !inFocus(n.neighborhood_id);
        const r = (4 + frac * 18) * (isHi ? 1.35 : 1);
        extend(n.latitude, n.longitude);
        const el = document.createElement('div');
        el.style.width = `${r * 2}px`;
        el.style.height = `${r * 2}px`;
        el.style.borderRadius = '50%';
        el.style.backgroundColor = `${color}73`;
        el.style.border = `2px solid ${isHi ? '#F0A0EA' : color}`;
        el.style.boxShadow = isHi ? '0 0 0 3px rgba(240,160,234,.5)' : 'none';
        el.style.cursor = 'pointer';
        el.style.opacity = dimmed ? '0.22' : '1';
        el.style.display = focusMembers && dimmed && neighborhoods.length > 40 ? 'none' : 'block';
        const popup = new mapboxgl.Popup({ offset: 12, closeButton: false }).setHTML(
          `<b>${n.neighborhood_id}</b> ${n.name || ''}<br/>${n.daily_orders} orders • ${n.zone || 'Unzoned'}<br/>${Number(n.latitude).toFixed(4)}, ${Number(n.longitude).toFixed(4)}<br/>Color: ${tag}${a ? `<br/>→ ${a.warehouse_id} (${a.distance_km} km)` : ''}`
        );
        const marker = new mapboxgl.Marker({ element: el }).setLngLat([n.longitude, n.latitude]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);
      });
    } else {
      neighborhoods.forEach((n) => extend(n.latitude, n.longitude));
    }

    const whById = new Map(warehouses.map((w) => [w.warehouse_id, w]));
    if (showWarehouses) {
      warehouses.forEach((w) => {
        extend(w.latitude, w.longitude);
        const isFocused = focusedWarehouseId === w.warehouse_id;
        const dimmed = !!focusedWarehouseId && !isFocused;
        const color = whColor(w.warehouse_id);
        const el = document.createElement('div');
        el.style.background = color;
        el.style.color = '#fff';
        el.style.fontWeight = '800';
        el.style.fontSize = isFocused ? '13px' : '11px';
        el.style.borderRadius = '10px';
        el.style.padding = isFocused ? '5px 12px' : '3px 9px';
        el.style.border = isFocused ? `3px solid #111827` : `2px solid ${pinBorder}`;
        el.style.boxShadow = isFocused ? '0 0 0 4px rgba(17,24,39,.25), 0 2px 8px rgba(0,0,0,.35)' : '0 2px 6px rgba(0,0,0,.3)';
        el.style.cursor = 'pointer';
        el.style.whiteSpace = 'nowrap';
        el.style.opacity = dimmed ? '0.35' : '1';
        el.title = `Click to ${isFocused ? 'clear focus on' : 'focus'} ${w.warehouse_id}`;
        el.textContent = w.warehouse_id;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (warehouseClickRef.current) warehouseClickRef.current(w.warehouse_id);
        });
        const memberCount = focusMembers && isFocused ? focusMembers.size : undefined;
        const popup = new mapboxgl.Popup({ offset: 14, closeButton: false }).setHTML(
          `<b>${w.warehouse_id}</b> — click to ${isFocused ? 'clear focus' : 'isolate zone'}<br/>${Number(w.latitude).toFixed(4)}, ${Number(w.longitude).toFixed(4)}<br/>${w.assigned_orders || 0} orders${memberCount != null ? ` • ${memberCount} nodes` : ''}`
        );
        const marker = new mapboxgl.Marker({ element: el }).setLngLat([w.longitude, w.latitude]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);
      });
    }

    // Service-radius overlay. Roads mode draws the road-network service area
    // (Mapbox isochrone polygons per warehouse, nested contours forming a
    // heat gradient); anywhere else — or when isochrones are unavailable —
    // straight-line geodesic circles.
    if (showRadius && showWarehouses && radiusKm && radiusKm > 0 && warehouses.length > 0) {
      // Phase B (#1): focus isolates the zone — only the selected boundary stays.
      const radiusWarehouses = focusedWarehouseId
        ? warehouses.filter((w) => w.warehouse_id === focusedWarehouseId)
        : warehouses;
      const isoEntries = linesMode === 'roads'
        ? radiusWarehouses.flatMap((w) => {
            const feats = isochrones[w.warehouse_id] || [];
            if (feats.length === 0) return [];
            const contours = feats
              .map((f) => Number(f?.properties?.contour))
              .filter((c) => Number.isFinite(c));
            const maxC = contours.length ? Math.max(...contours) : 1;
            return feats.map((f) => {
              const c = Number(f?.properties?.contour);
              const inner = Number.isFinite(c) && contours.length > 1 && c < maxC;
              return {
                type: 'Feature' as const,
                properties: { color: whColor(w.warehouse_id), opacity: inner ? (focusedWarehouseId ? 0.32 : 0.22) : (focusedWarehouseId ? 0.16 : 0.09) },
                geometry: f.geometry as { type: 'Polygon'; coordinates: number[][][] }
              };
            });
          })
        : [];
      const features = isoEntries.length > 0
        ? isoEntries
        : radiusWarehouses.map((w) => ({
          type: 'Feature' as const,
          properties: {
            color: whColor(w.warehouse_id),
            opacity: focusedWarehouseId ? 0.14 : 0.06
          },
          geometry: { type: 'Polygon' as const, coordinates: circlePolygon(w.latitude, w.longitude, radiusKm) }
        }));
      try {
        map.addSource(RADIUS_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features } });
        map.addLayer({
          id: `${RADIUS_SRC}-fill`,
          type: 'fill',
          source: RADIUS_SRC,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] }
        });
        map.addLayer({
          id: `${RADIUS_SRC}-line`,
          type: 'line',
          source: RADIUS_SRC,
          paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [2, 2] }
        });
      } catch { /* style race — next render retries */ }
    }

    // Assignment lines neighborhood → warehouse (must match assignment table).
    // Roads mode draws traced driving paths where available, straight lines otherwise.
    // Phase B (#1 focus): non-selected zones dim to 0.08; (#5 display): traffic
    // mode colors each corridor segment green→amber→red via congestion_pct.
    if (showRoutes && assignments.length > 0) {
      const okFeatures: unknown[] = [];
      const badFeatures: unknown[] = [];
      assignments.forEach((a) => {
        const nb = neighborhoods.find((n) => n.neighborhood_id === a.neighborhood_id);
        const wh = whById.get(a.warehouse_id);
        if (!nb || !wh) return;
        const traced = linesMode === 'roads' ? roadGeometries[a.neighborhood_id] : undefined;
        const validRing = (pts: unknown): pts is number[][] =>
          Array.isArray(pts) &&
          pts.length >= 2 &&
          pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v)));
        const fallback: number[][] = [[nb.longitude, nb.latitude], [wh.longitude, wh.latitude]];
        if (!validRing(fallback)) return;
        const coords = validRing(traced) ? (traced as number[][]) : fallback;
        const dimmed = focusMembers != null && !focusMembers.has(a.neighborhood_id);
        const feat = {
          type: 'Feature',
          properties: {
            color: routePaint(a),
            neighborhood_id: a.neighborhood_id,
            traced: traced && traced.length >= 2 ? 1 : 0,
            opacity: dimmed ? 0.08 : 0.85
          },
          geometry: {
            type: 'LineString',
            coordinates: coords
          }
        };
        (a.is_feasible ? okFeatures : badFeatures).push(feat);
      });
      try {
        if (okFeatures.length > 0) {
          map.addSource(ROUTES_OK, { type: 'geojson', data: { type: 'FeatureCollection', features: okFeatures as never[] } });
          map.addLayer({
            id: ROUTES_OK,
            type: 'line',
            source: ROUTES_OK,
            paint: {
              'line-color': ['get', 'color'],
              'line-width': routeColor || colorRoutesByTraffic ? 2.5 : 1,
              'line-opacity': ['get', 'opacity'] as unknown as number
            }
          });
        }
        if (badFeatures.length > 0) {
          map.addSource(ROUTES_BAD, { type: 'geojson', data: { type: 'FeatureCollection', features: badFeatures as never[] } });
          map.addLayer({
            id: ROUTES_BAD,
            type: 'line',
            source: ROUTES_BAD,
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 1.5,
              'line-opacity': ['get', 'opacity'] as unknown as number,
              'line-dasharray': [2, 2]
            }
          });
        }
      } catch { /* style race — next render retries */ }
    }

    if (hasBounds && !focus) {
      const prev = fittedRef.current;
      if (prev.n !== neighborhoods || prev.w !== warehouses || prev.a !== assignments) {
        fittedRef.current = { n: neighborhoods, w: warehouses, a: assignments };
        try {
          map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
        } catch {
          /* single-point safe */
        }
      }
    }
    // Re-apply 3D extrusions after every style swap / overlay refresh.
    sync3DBuildings(map, threeDRef.current);
    try {
      map.resize();
    } catch { /* ignore */ }
  }, [neighborhoods, warehouses, assignments, radiusKm, basemap, styleReady, token, colorBy, zoneColors, showWarehouses, showRoutes, showDemand, showRadius, routeColor, colorRoutesByTraffic, linesMode, roadGeometries, isochrones, theme, highlightId, focus, focusedWarehouseId, coverageCells, coverageMeta, showHeatmap, onWarehouseClick]);

  // Fly-to on focus requests (gmaps "Center" action)
  useEffect(() => {
    if (focus && mapRef.current) {
      try {
        mapRef.current.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom ?? 14, duration: 900 });
      } catch {
        /* ignore */
      }
    }
  }, [focus]);

  const counts = zoneCounts(neighborhoods);
  const zoneList = Object.keys(counts).sort((a, b) => a.localeCompare(b));

  if (!token) {
    return (
      <div
        style={fill ? { height: '100%' } : { height }}
        className="flex items-center justify-center bg-slate-100 rounded-3xl border border-slate-200 p-8 text-center"
      >
        <div className="max-w-md">
          <h3 className="font-bold text-sm text-slate-900">🗺️ Mapbox token missing</h3>
          <p className="text-[12px] text-slate-600 mt-2">
            Mapbox needs a public token even for local dev (free tier covers it).
            Get one at <span className="font-mono">mapbox.com → Account → Tokens</span>, then:
          </p>
          <pre className="mt-3 text-left text-[11px] font-mono bg-slate-900 text-gold-300 rounded-xl p-3 overflow-x-auto">
{`# frontend/.env.local\nVITE_MAPBOX_TOKEN=pk.your_token_here`}
          </pre>
          <p className="text-[11px] text-slate-500 mt-2">Restart <span className="font-mono">pnpm dev</span> after adding it.</p>
        </div>
      </div>
    );
  }

  if (minimal) {
    return (
      <div className="relative h-full w-full">
        <div ref={divRef} style={fill ? { height: '100%' } : { height }} className="z-0 h-full w-full" />
        <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-2 max-w-[calc(100%-2rem)]">
          {colorRoutesByTraffic && assignments.length > 0 && (
            <div className="bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-2xl px-3 py-2 shadow-lg flex items-center gap-3 text-[10px] font-semibold text-slate-600">
              <span className="uppercase tracking-wide text-slate-400">Traffic</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" /> Fluid</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" /> Busy</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" /> Jammed</span>
            </div>
          )}
          {showHeatmap && coverageCells.length > 0 && (
            <div className="bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-2xl px-3 py-2 shadow-lg text-[10px] font-semibold text-slate-600">
              <div className="flex items-center justify-between gap-3">
                <span className="uppercase tracking-wide text-slate-400">Coverage</span>
                {coverageRange && (
                  <span className="font-mono text-slate-500">{coverageRange.minKm} km → {coverageRange.maxKm} km</span>
                )}
              </div>
              <div
                className="mt-1.5 h-2 w-44 rounded-full"
                style={{ background: 'linear-gradient(90deg,#22c55e,#f59e0b,#ef4444)' }}
              />
              <div className="mt-1 flex items-center justify-between text-slate-500">
                <span>Near warehouse</span>
                <span>Far</span>
              </div>
            </div>
          )}
          {focusedWarehouseId && (
            <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-800 rounded-2xl px-3 py-2 shadow-lg flex items-center gap-2 text-[11px] font-bold text-white">
              <span className="w-2.5 h-2.5 rounded-full bg-white/80" />
              Zone {focusedWarehouseId} isolated — other zones dimmed
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-sm text-slate-900">🗺️ Assignment Map Overlay</h3>
        <div className="flex flex-wrap items-center gap-2">
          {/* Basemap theme switcher */}
          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-0.5 text-[11px]">
            {(Object.keys(BASEMAPS) as BasemapStyle[]).map((b) => (
              <button
                key={b}
                onClick={() => onBasemapChange(b)}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  basemap === b ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {BASEMAPS[b].label}
              </button>
            ))}
          </div>
          {/* Color-by theme switcher */}
          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-0.5 text-[11px]">
            {COLOR_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => onColorByChange(m.id)}
                title={m.id === 'warehouse' ? 'Color bubbles by assigned warehouse' : m.id === 'zone' ? 'Color bubbles by zone / category' : 'Color bubbles by demand intensity'}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  colorBy === m.id ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="px-5 pt-2 text-[11px] text-slate-500">
        {neighborhoods.length} nodes • {warehouses.length} warehouses • {assignments.length} lines
        {radiusKm ? (linesMode === 'roads' && warehouses.some((w) => (isochrones[w.warehouse_id] || []).length > 0) ? ` • R_max ${radiusKm} km by road` : ` • R_max ${radiusKm} km`) : ''}
      </div>
      <div ref={divRef} style={fill ? { height: '100%' } : { height }} className="z-0" />
      <div className="px-5 py-2 border-t border-slate-100 flex flex-wrap gap-3 text-[11px] text-slate-600">
        {colorBy === 'warehouse' && warehouses.map((w) => (
          <span key={w.warehouse_id} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: whColor(w.warehouse_id) }} />
            {w.warehouse_id} ({w.assigned_orders || 0} orders)
          </span>
        ))}
        {colorBy === 'zone' && zoneList.map((z) => (
          <span key={z} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full border border-white shadow-xs" style={{ background: colorForZone(z, zoneColors) }} />
            {z} ({counts[z]})
          </span>
        ))}
        {colorBy === 'demand' && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-[#0ea5e9]" /> Low
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3.5 h-3.5 rounded-full bg-[#f59e0b]" /> Medium
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded-full bg-[#ef4444]" /> High
            </span>
          </>
        )}
        {colorBy === 'warehouse' && warehouses.length === 0 && (
          <span className="text-slate-400">Run optimization to see warehouse pins + assignment lines.</span>
        )}
      </div>
    </div>
  );
};
