import React from 'react';
import { MapPin, Truck, Warehouse as WarehouseIcon, ShoppingCart, ArrowRight, Eye } from 'lucide-react';
import type { Neighborhood, VehicleType, Warehouse } from '../types';

export interface SeedResult {
  source: string;
  nodes: Neighborhood[];
  vehicles: VehicleType[];
  warehouses: Warehouse[];
  at: number;
}

interface SeedResultsPanelProps {
  seed: SeedResult;
  onLoadNodes: (nodes: Neighborhood[]) => void;
  onLoadVehicles: (vehicles: VehicleType[]) => void;
  onLoadWarehouses: (warehouses: Warehouse[]) => void;
  onViewOnMap: (nodes: Neighborhood[]) => void;
  onOpenNode: (node: Neighborhood) => void;
}

/**
 * Phase G (#4): seeding shows what it created — counts + per-entity tables
 * (warehouses / vehicles / nodes / orders) with "load into workspace" and
 * "view on map" actions. Every entity row is clickable to map/detail.
 */
export const SeedResultsPanel: React.FC<SeedResultsPanelProps> = ({
  seed,
  onLoadNodes,
  onLoadVehicles,
  onLoadWarehouses,
  onViewOnMap,
  onOpenNode
}) => {
  const totalOrders = seed.nodes.reduce((s, n) => s + (Number(n.daily_orders) || 0), 0);
  const previewNodes = seed.nodes.slice(0, 8);
  const previewVehicles = seed.vehicles.slice(0, 5);
  const previewSites = seed.warehouses.slice(0, 5);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-ink">Seed results — {seed.source}</h3>
          <p className="text-[11px] text-ink-faint">
            {new Date(seed.at).toLocaleTimeString()} • exact counts of what was created
          </p>
        </div>
        <button
          onClick={() => onViewOnMap(seed.nodes)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-cream-deep hover:bg-gold-100 text-ink rounded-full text-xs font-bold transition cursor-pointer"
        >
          <Eye className="w-3.5 h-3.5" /> View on map
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-cream-deep rounded-2xl border border-[#E4E1D2] px-2 py-2.5">
          <MapPin className="w-4 h-4 mx-auto text-ink-soft" />
          <div className="text-base font-extrabold text-ink">{seed.nodes.length}</div>
          <div className="text-[10px] font-semibold text-ink-faint uppercase">Nodes</div>
        </div>
        <div className="bg-cream-deep rounded-2xl border border-[#E4E1D2] px-2 py-2.5">
          <ShoppingCart className="w-4 h-4 mx-auto text-ink-soft" />
          <div className="text-base font-extrabold text-ink">{totalOrders.toLocaleString()}</div>
          <div className="text-[10px] font-semibold text-ink-faint uppercase">Orders</div>
        </div>
        <div className="bg-cream-deep rounded-2xl border border-[#E4E1D2] px-2 py-2.5">
          <WarehouseIcon className="w-4 h-4 mx-auto text-ink-soft" />
          <div className="text-base font-extrabold text-ink">{seed.warehouses.length}</div>
          <div className="text-[10px] font-semibold text-ink-faint uppercase">Warehouses</div>
        </div>
        <div className="bg-cream-deep rounded-2xl border border-[#E4E1D2] px-2 py-2.5">
          <Truck className="w-4 h-4 mx-auto text-ink-soft" />
          <div className="text-base font-extrabold text-ink">{seed.vehicles.length}</div>
          <div className="text-[10px] font-semibold text-ink-faint uppercase">Vehicles</div>
        </div>
      </div>

      {seed.nodes.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-ink-faint uppercase tracking-wider">
              Nodes ({seed.nodes.length})
            </span>
            <button
              onClick={() => onLoadNodes(seed.nodes)}
              className="flex items-center gap-1 text-[11px] font-bold text-ink hover:underline cursor-pointer"
            >
              Load into workspace <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1">
            {previewNodes.map((n) => (
              <button
                key={n.neighborhood_id}
                onClick={() => onOpenNode(n)}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl hover:bg-cream-deep transition text-left cursor-pointer"
              >
                <span className="text-[12px] font-bold text-ink truncate">
                  <span className="font-mono">{n.neighborhood_id}</span> • {n.name}
                </span>
                <span className="text-[11px] text-ink-faint shrink-0">{n.daily_orders} orders</span>
              </button>
            ))}
            {seed.nodes.length > previewNodes.length && (
              <p className="text-[10px] text-ink-faint text-center">
                +{seed.nodes.length - previewNodes.length} more — load into workspace to browse all
              </p>
            )}
          </div>
        </div>
      )}

      {seed.warehouses.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-ink-faint uppercase tracking-wider">
              Warehouses ({seed.warehouses.length})
            </span>
            <button
              onClick={() => onLoadWarehouses(seed.warehouses)}
              className="flex items-center gap-1 text-[11px] font-bold text-ink hover:underline cursor-pointer"
            >
              Load sites <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1">
            {previewSites.map((w) => (
              <div key={w.warehouse_id} className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-cream-deep/50">
                <span className="text-[12px] font-bold text-ink font-mono">{w.warehouse_id}</span>
                <span className="text-[11px] text-ink-faint">
                  {Number(w.latitude).toFixed(3)}, {Number(w.longitude).toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {seed.vehicles.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-ink-faint uppercase tracking-wider">
              Vehicles ({seed.vehicles.length})
            </span>
            <button
              onClick={() => onLoadVehicles(seed.vehicles)}
              className="flex items-center gap-1 text-[11px] font-bold text-ink hover:underline cursor-pointer"
            >
              Load fleet <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1">
            {previewVehicles.map((v) => (
              <div key={v.vehicle_type} className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-cream-deep/50">
                <span className="text-[12px] font-bold text-ink font-mono">{v.vehicle_type}</span>
                <span className="text-[11px] text-ink-faint">
                  {v.fuel_type} • cap {v.capacity}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
