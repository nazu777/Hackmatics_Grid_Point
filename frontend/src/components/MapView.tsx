import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Neighborhood, Warehouse, Assignment, BasemapStyle, ColorByMode, ZoneColorMap } from '../types';
import { BASEMAPS, getMapboxToken, colorForZone, zoneCounts } from './mapThemes';

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
  /** Click a route line to trace its road path (roads mode, large datasets). */
  onRouteClick?: (neighborhoodId: string) => void;
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
const BUILDINGS_LAYER = 'gp-3d-buildings';

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
  onRouteClick,
  theme = 'light',
  minimal = false,
  highlightId = null
}) => {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const routeClickRef = useRef<((id: string) => void) | undefined>(undefined);
  routeClickRef.current = onRouteClick;
  const styleRef = useRef<string>('');
  const threeDRef = useRef(false);
  const threeDBtnRef = useRef<HTMLButtonElement | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const token = getMapboxToken();

  // Create the map once (token must exist)
  useEffect(() => {
    if (!divRef.current || mapRef.current || !token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: divRef.current,
      style: BASEMAPS[basemap].style,
      center: [78.486, 17.385],
      zoom: 11,
      maxPitch: 75
    });
    styleRef.current = BASEMAPS[basemap].style;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

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

    // Clear previous markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    removeLayerAndSource(map, ROUTES_OK, ROUTES_OK);
    removeLayerAndSource(map, ROUTES_BAD, ROUTES_BAD);
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

    if (showDemand) {
      neighborhoods.forEach((n) => {
        const a = asgByNb.get(n.neighborhood_id);
        const { color, tag } = resolveColor(n);
        const frac = Math.sqrt((Number(n.daily_orders) || 0) / Math.max(1, maxOrders));
        const isHi = highlightId === n.neighborhood_id;
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
        const color = whColor(w.warehouse_id);
        const el = document.createElement('div');
        el.style.background = color;
        el.style.color = '#fff';
        el.style.fontWeight = '800';
        el.style.fontSize = '11px';
        el.style.borderRadius = '10px';
        el.style.padding = '3px 9px';
        el.style.border = `2px solid ${pinBorder}`;
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
        el.style.cursor = 'pointer';
        el.style.whiteSpace = 'nowrap';
        el.textContent = w.warehouse_id;
        const popup = new mapboxgl.Popup({ offset: 14, closeButton: false }).setHTML(
          `<b>${w.warehouse_id}</b><br/>${Number(w.latitude).toFixed(4)}, ${Number(w.longitude).toFixed(4)}<br/>${w.assigned_orders || 0} orders`
        );
        const marker = new mapboxgl.Marker({ element: el }).setLngLat([w.longitude, w.latitude]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);
      });
    }

    // Service-radius circles as filled GeoJSON polygons
    if (showRadius && showWarehouses && radiusKm && radiusKm > 0 && warehouses.length > 0) {
      const features = warehouses.map((w) => ({
        type: 'Feature' as const,
        properties: { color: whColor(w.warehouse_id) },
        geometry: { type: 'Polygon' as const, coordinates: circlePolygon(w.latitude, w.longitude, radiusKm) }
      }));
      try {
        map.addSource(RADIUS_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features } });
        map.addLayer({
          id: `${RADIUS_SRC}-fill`,
          type: 'fill',
          source: RADIUS_SRC,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.06 }
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
        const feat = {
          type: 'Feature',
          properties: {
            color: routePaint(a),
            neighborhood_id: a.neighborhood_id,
            traced: traced && traced.length >= 2 ? 1 : 0
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
            paint: { 'line-color': ['get', 'color'], 'line-width': routeColor || colorRoutesByTraffic ? 2.5 : 1, 'line-opacity': 0.8 }
          });
        }
        if (badFeatures.length > 0) {
          map.addSource(ROUTES_BAD, { type: 'geojson', data: { type: 'FeatureCollection', features: badFeatures as never[] } });
          map.addLayer({
            id: ROUTES_BAD,
            type: 'line',
            source: ROUTES_BAD,
            paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9, 'line-dasharray': [2, 2] }
          });
        }
      } catch { /* style race — next render retries */ }
    }

    if (hasBounds && !focus) {
      try {
        map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
      } catch {
        /* single-point safe */
      }
    }
    // Re-apply 3D extrusions after every style swap / overlay refresh.
    sync3DBuildings(map, threeDRef.current);
    try {
      map.resize();
    } catch { /* ignore */ }
  }, [neighborhoods, warehouses, assignments, radiusKm, basemap, styleReady, token, colorBy, zoneColors, showWarehouses, showRoutes, showDemand, showRadius, routeColor, colorRoutesByTraffic, linesMode, roadGeometries, theme, highlightId, focus]);

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
        {colorRoutesByTraffic && assignments.length > 0 && (
          <div className="absolute bottom-4 left-4 z-10 bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-2xl px-3 py-2 shadow-lg flex items-center gap-3 text-[10px] font-semibold text-slate-600">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" /> Fluid</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" /> Busy</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" /> Jammed</span>
          </div>
        )}
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
        {radiusKm ? ` • R_max ${radiusKm} km` : ''}
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
