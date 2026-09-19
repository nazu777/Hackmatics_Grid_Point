import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Neighborhood, Warehouse, Assignment, BasemapStyle, ColorByMode, ZoneColorMap } from '../types';
import { BASEMAPS, colorForZone, zoneCounts } from './mapThemes';

const PALETTE = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1'];

function whColor(warehouseId: string): string {
  const n = parseInt(warehouseId.replace(/\D/g, '') || '1', 10);
  return PALETTE[(n - 1) % PALETTE.length];
}

function demandColor(orders: number, minOrders: number, maxOrders: number): { color: string; category: string } {
  const ratio = maxOrders <= minOrders ? 0.5 : Math.max(0, Math.min(1, (orders - minOrders) / (maxOrders - minOrders)));
  if (ratio >= 0.66) return { color: '#ef4444', category: 'High' };
  if (ratio >= 0.33) return { color: '#f59e0b', category: 'Medium' };
  return { color: '#10b981', category: 'Low' };
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
  theme = 'light',
  minimal = false,
  highlightId = null
}) => {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    if (!divRef.current) return;
    if (!mapRef.current) {
      mapRef.current = L.map(divRef.current, { zoomControl: false }).setView([17.385, 78.486], 11);
      L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
    }
    const map = mapRef.current;

    // Swap basemap tiles when theme changes
    const wantUrl = BASEMAPS[basemap].url;
    if (!tileRef.current || (tileRef.current as L.TileLayer & { _url?: string })._url !== wantUrl) {
      if (tileRef.current) map.removeLayer(tileRef.current);
      tileRef.current = L.tileLayer(wantUrl, { attribution: BASEMAPS[basemap].attribution });
      tileRef.current.addTo(map);
    }

    // Clear overlay layers (keep tile layer)
    map.eachLayer((layer) => {
      if (layer !== tileRef.current) map.removeLayer(layer);
    });

    const asgByNb = new Map(assignments.map((a) => [a.neighborhood_id, a]));
    const orders = neighborhoods.map((n) => Number(n.daily_orders) || 0);
    const minOrders = orders.length ? Math.min(...orders) : 0;
    const maxOrders = orders.length ? Math.max(...orders) : 1;
    const bounds: L.LatLngExpression[] = [];

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

    if (showDemand) {
      neighborhoods.forEach((n) => {
        const a = asgByNb.get(n.neighborhood_id);
        const { color, tag } = resolveColor(n);
        const frac = Math.sqrt((Number(n.daily_orders) || 0) / Math.max(1, maxOrders));
        const isHi = highlightId === n.neighborhood_id;
        const r = (4 + frac * 18) * (isHi ? 1.35 : 1);
        bounds.push([n.latitude, n.longitude]);
        L.circleMarker([n.latitude, n.longitude], {
          radius: r,
          color: isHi ? '#F0A0EA' : color,
          weight: isHi ? 3 : 2,
          fillColor: color,
          fillOpacity: 0.45
        })
          .bindTooltip(
            `<b>${n.neighborhood_id}</b> ${n.name || ''}<br/>${n.daily_orders} orders • ${n.zone || 'Unzoned'}<br/>${n.latitude.toFixed(4)}, ${n.longitude.toFixed(4)}<br/>Color: ${tag}${a ? `<br/>→ ${a.warehouse_id} (${a.distance_km} km)` : ''}`
          )
          .addTo(map);
      });
    } else {
      neighborhoods.forEach((n) => bounds.push([n.latitude, n.longitude]));
    }

    const whById = new Map(warehouses.map((w) => [w.warehouse_id, w]));
    if (showWarehouses) {
      warehouses.forEach((w) => {
        bounds.push([w.latitude, w.longitude]);
        const color = whColor(w.warehouse_id);
        L.marker([w.latitude, w.longitude], {
          icon: L.divIcon({
            className: '',
            html: `<div style="background:${color};color:#fff;font-weight:800;font-size:11px;border-radius:10px;padding:3px 9px;border:2px solid ${pinBorder};box-shadow:0 2px 6px rgba(0,0,0,.3)">${w.warehouse_id}</div>`,
            iconSize: [44, 24],
            iconAnchor: [22, 12]
          })
        })
          .bindTooltip(`<b>${w.warehouse_id}</b><br/>${w.latitude.toFixed(4)}, ${w.longitude.toFixed(4)}<br/>${w.assigned_orders || 0} orders`)
          .addTo(map);
        if (showRadius && radiusKm && radiusKm > 0) {
          L.circle([w.latitude, w.longitude], {
            radius: radiusKm * 1000,
            color,
            weight: 1.5,
            dashArray: '6 6',
            fillOpacity: 0.06
          }).addTo(map);
        }
      });
    }

    // Polylines neighborhood → assigned warehouse (must match assignment table)
    if (showRoutes) {
      assignments.forEach((a) => {
        const nb = neighborhoods.find((n) => n.neighborhood_id === a.neighborhood_id);
        const wh = whById.get(a.warehouse_id);
        if (!nb || !wh) return;
        L.polyline([[nb.latitude, nb.longitude], [wh.latitude, wh.longitude]], {
          color: lineColor(a.warehouse_id),
          weight: routeColor ? 2 : 1,
          opacity: a.is_feasible ? 0.75 : 0.9,
          dashArray: a.is_feasible ? undefined : '4 4'
        }).addTo(map);
      });
    }

    if (bounds.length > 0 && !focus) {
      try {
        map.fitBounds(L.latLngBounds(bounds).pad(0.15));
      } catch {
        /* single-point safe */
      }
    }
    map.invalidateSize();
  }, [neighborhoods, warehouses, assignments, radiusKm, basemap, colorBy, zoneColors, showWarehouses, showRoutes, showDemand, showRadius, routeColor, theme, highlightId, focus]);

  // Fly-to on focus requests (gmaps "Center" action)
  useEffect(() => {
    if (focus && mapRef.current) {
      try {
        mapRef.current.flyTo([focus.lat, focus.lon], focus.zoom ?? 14, { duration: 0.9 });
      } catch {
        /* ignore */
      }
    }
  }, [focus]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      tileRef.current = null;
    };
  }, []);

  const counts = zoneCounts(neighborhoods);
  const zoneList = Object.keys(counts).sort((a, b) => a.localeCompare(b));

  if (minimal) {
    return <div ref={divRef} style={fill ? { height: '100%' } : { height }} className="z-0 h-full w-full" />;
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
              <span className="inline-block w-3 h-3 rounded-full bg-[#10b981]" /> Low
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
