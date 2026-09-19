import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Neighborhood, Warehouse, Assignment } from '../types';

const PALETTE = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1'];

function whColor(warehouseId: string): string {
  const n = parseInt(warehouseId.replace(/\D/g, '') || '1', 10);
  return PALETTE[(n - 1) % PALETTE.length];
}

interface MapViewProps {
  neighborhoods: Neighborhood[];
  warehouses?: Warehouse[];
  assignments?: Assignment[];
  radiusKm?: number | null;
  height?: number;
}

export const MapView: React.FC<MapViewProps> = ({
  neighborhoods,
  warehouses = [],
  assignments = [],
  radiusKm = null,
  height = 420
}) => {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!divRef.current) return;
    if (!mapRef.current) {
      mapRef.current = L.map(divRef.current).setView([17.385, 78.486], 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(mapRef.current);
    }
    const map = mapRef.current;
    // Clear overlay layers (keep tile layer)
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
    });

    const asgByNb = new Map(assignments.map((a) => [a.neighborhood_id, a]));
    const maxOrders = Math.max(1, ...neighborhoods.map((n) => Number(n.daily_orders) || 0));
    const bounds: L.LatLngExpression[] = [];

    neighborhoods.forEach((n) => {
      const a = asgByNb.get(n.neighborhood_id);
      const color = a ? whColor(a.warehouse_id) : '#64748b';
      const frac = Math.sqrt((Number(n.daily_orders) || 0) / maxOrders);
      const r = 4 + frac * 18;
      bounds.push([n.latitude, n.longitude]);
      L.circleMarker([n.latitude, n.longitude], {
        radius: r,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.45
      })
        .bindTooltip(
          `<b>${n.neighborhood_id}</b> ${n.name || ''}<br/>${n.daily_orders} orders<br/>${n.latitude.toFixed(4)}, ${n.longitude.toFixed(4)}${a ? `<br/>→ ${a.warehouse_id} (${a.distance_km} km)` : ''}`
        )
        .addTo(map);
    });

    const whById = new Map(warehouses.map((w) => [w.warehouse_id, w]));
    warehouses.forEach((w) => {
      bounds.push([w.latitude, w.longitude]);
      const color = whColor(w.warehouse_id);
      L.marker([w.latitude, w.longitude], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:${color};color:#fff;font-weight:800;font-size:11px;border-radius:10px;padding:3px 9px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">${w.warehouse_id}</div>`,
          iconSize: [44, 24],
          iconAnchor: [22, 12]
        })
      })
        .bindTooltip(`<b>${w.warehouse_id}</b><br/>${w.latitude.toFixed(4)}, ${w.longitude.toFixed(4)}<br/>${w.assigned_orders || 0} orders`)
        .addTo(map);
      if (radiusKm && radiusKm > 0) {
        L.circle([w.latitude, w.longitude], {
          radius: radiusKm * 1000,
          color,
          weight: 1.5,
          dashArray: '6 6',
          fillOpacity: 0.06
        }).addTo(map);
      }
    });

    // Polylines neighborhood → assigned warehouse (must match assignment table)
    assignments.forEach((a) => {
      const nb = neighborhoods.find((n) => n.neighborhood_id === a.neighborhood_id);
      const wh = whById.get(a.warehouse_id);
      if (!nb || !wh) return;
      L.polyline([[nb.latitude, nb.longitude], [wh.latitude, wh.longitude]], {
        color: whColor(a.warehouse_id),
        weight: 1,
        opacity: a.is_feasible ? 0.55 : 0.9,
        dashArray: a.is_feasible ? undefined : '4 4'
      }).addTo(map);
    });

    if (bounds.length > 0) {
      try {
        map.fitBounds(L.latLngBounds(bounds).pad(0.15));
      } catch {
        /* single-point safe */
      }
    }
    map.invalidateSize();
  }, [neighborhoods, warehouses, assignments, radiusKm]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-bold text-sm text-slate-900">🗺️ Assignment Map Overlay</h3>
        <span className="text-[11px] text-slate-500">
          {neighborhoods.length} nodes • {warehouses.length} warehouses • {assignments.length} lines
          {radiusKm ? ` • R_max ${radiusKm} km` : ''}
        </span>
      </div>
      <div ref={divRef} style={{ height }} className="z-0" />
      <div className="px-5 py-2 border-t border-slate-100 flex flex-wrap gap-3 text-[11px] text-slate-600">
        {warehouses.map((w) => (
          <span key={w.warehouse_id} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: whColor(w.warehouse_id) }} />
            {w.warehouse_id} ({w.assigned_orders || 0} orders)
          </span>
        ))}
        {warehouses.length === 0 && <span className="text-slate-400">Run optimization to see warehouse pins + assignment lines.</span>}
      </div>
    </div>
  );
};
