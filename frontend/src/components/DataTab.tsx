import React, { useState } from 'react';
import {
  Package, Truck, Warehouse as WarehouseIcon, Plus, Database
} from 'lucide-react';
import {
  Neighborhood, ValidationResult, DatasetSummary, VehicleType,
  Warehouse as WarehouseType
} from '../types';
import { DataTable } from './DataTable';
import { VehicleTable } from './VehicleTable';
import { WarehouseTable } from './WarehouseTable';
import { AddDataModal, type AddDataset } from './AddDataModal';

export type DataSubtab = 'orders' | 'vehicles' | 'warehouses';

interface DataTabProps {
  neighborhoods: Neighborhood[];
  vehicles: VehicleType[];
  warehouses: WarehouseType[];
  ordersValidation: ValidationResult;
  vehiclesValidation: ValidationResult;
  warehousesValidation: ValidationResult;
  summary: DatasetSummary;
  center: { lat: number; lon: number } | null;
  onOrdersChange: (nodes: Neighborhood[]) => void;
  onVehiclesChange: (v: VehicleType[]) => void;
  onWarehousesChange: (w: WarehouseType[]) => void;
  onOrdersLoaded: (nodes: Neighborhood[], validation: ValidationResult, summary: DatasetSummary) => void;
  onVehiclesLoaded: (vehicles: VehicleType[], validation: ValidationResult, summary: any) => void;
  onWarehousesLoaded: (warehouses: WarehouseType[], validation: ValidationResult, summary: any) => void;
  onOpenCensus: () => void;
  onLoadSample: () => void;
}

const ADD_LABEL: Record<AddDataset, string> = {
  orders: 'Add order',
  vehicles: 'Add vehicle',
  warehouses: 'Add warehouse'
};

export const DataTab: React.FC<DataTabProps> = (props) => {
  const {
    neighborhoods, vehicles, warehouses,
    ordersValidation, vehiclesValidation, warehousesValidation,
    summary, center,
    onOrdersChange, onVehiclesChange, onWarehousesChange,
    onOrdersLoaded, onVehiclesLoaded, onWarehousesLoaded,
    onOpenCensus, onLoadSample
  } = props;

  const [subtab, setSubtab] = useState<DataSubtab>(() => {
    try {
      const v = localStorage.getItem('gridpoint_data_subtab') as DataSubtab | null;
      return v === 'vehicles' || v === 'warehouses' ? v : 'orders';
    } catch { return 'orders'; }
  });
  const setSubtabPersist = (t: DataSubtab) => {
    setSubtab(t);
    try { localStorage.setItem('gridpoint_data_subtab', t); } catch { /* ignore */ }
  };

  const [addOpen, setAddOpen] = useState(false);

  const tabs: { id: DataSubtab; label: string; icon: React.ElementType; count: number }[] = [
    { id: 'orders', label: 'Orders', icon: Package, count: neighborhoods.length },
    { id: 'vehicles', label: 'Vehicles', icon: Truck, count: vehicles.length },
    { id: 'warehouses', label: 'Warehouses', icon: WarehouseIcon, count: warehouses.length }
  ];

  return (
    <div className="space-y-4">
      {/* Subtab switcher with live counts */}
      <div className="flex items-center gap-1.5 p-1 rounded-full bg-cream-deep border border-[#E4E1D2]">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = subtab === t.id;
          return (
            <button key={t.id} onClick={() => setSubtabPersist(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold transition cursor-pointer ${
                active ? 'bg-white shadow text-ink' : 'text-ink-faint hover:text-ink'
              }`}>
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
              <span className={`px-1.5 py-0.5 rounded-full font-mono text-[10px] ${active ? 'bg-[#14424E] text-white' : 'bg-white text-ink-faint border border-[#E4E1D2]'}`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {subtab === 'orders' && (
        <div className="space-y-4">
          <div className="card p-4 flex items-center gap-3">
            <span className="w-9 h-9 rounded-2xl bg-cream-deep flex items-center justify-center shrink-0">
              <Database className="w-4 h-4 text-ink" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[13px] text-ink">
                {summary.total_orders.toLocaleString()} orders
              </p>
              <p className="text-[11px] text-ink-faint">
                {(() => {
                  // An empty dataset reports EMPTY_DATASET — that's the neutral
                  // starting state, not a data problem, so don't surface it.
                  const issues = ordersValidation.errors.filter((e) => e.code !== 'EMPTY_DATASET');
                  if (issues.length > 0) {
                    return `${issues.length} validation issue${issues.length === 1 ? '' : 's'} — see table.`;
                  }
                  if (neighborhoods.length === 0) {
                    return 'No data yet — use Add order to upload or generate.';
                  }
                  return 'All rows valid — ready to optimize.';
                })()}
              </p>
            </div>
            <button onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer shrink-0">
              <Plus className="w-4 h-4" />
              <span>{ADD_LABEL.orders}</span>
            </button>
          </div>
          <DataTable neighborhoods={neighborhoods} errors={ordersValidation.errors} onChange={onOrdersChange} externalQuery="" />
        </div>
      )}

      {subtab === 'vehicles' && (
        <div className="space-y-4">
          <div className="card p-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[13px] text-ink">{vehicles.length} vehicles in fleet</p>
              <p className="text-[11px] text-ink-faint">
                {vehiclesValidation.valid || vehicles.length === 0
                  ? 'Fleet feeds per-km cost, ETA and fuel math at optimize time.'
                  : `${vehiclesValidation.errors.length} validation issue${vehiclesValidation.errors.length === 1 ? '' : 's'} — see table.`}
              </p>
            </div>
            <button onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer shrink-0">
              <Plus className="w-4 h-4" />
              <span>{ADD_LABEL.vehicles}</span>
            </button>
          </div>
          <VehicleTable vehicles={vehicles} errors={vehiclesValidation.errors} onChange={onVehiclesChange} externalQuery="" />
        </div>
      )}

      {subtab === 'warehouses' && (
        <div className="space-y-4">
          <div className="card p-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[13px] text-ink">{warehouses.length} existing sites</p>
              <p className="text-[11px] text-ink-faint">
                {(warehousesValidation.valid || warehouses.length === 0)
                  ? 'Doubles as the D-baseline + E keep/abandon set.'
                  : `${warehousesValidation.errors.length} validation issue${warehousesValidation.errors.length === 1 ? '' : 's'} — see table.`}
              </p>
            </div>
            <button onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer shrink-0">
              <Plus className="w-4 h-4" />
              <span>{ADD_LABEL.warehouses}</span>
            </button>
          </div>
          <WarehouseTable warehouses={warehouses} errors={warehousesValidation.errors} onChange={onWarehousesChange} externalQuery="" center={center} />
        </div>
      )}

      <AddDataModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        dataset={subtab}
        center={center}
        onOrdersLoaded={onOrdersLoaded}
        onVehiclesLoaded={onVehiclesLoaded}
        onWarehousesLoaded={onWarehousesLoaded}
        onOrdersChange={onOrdersChange}
        onVehiclesChange={onVehiclesChange}
        onWarehousesChange={onWarehousesChange}
        onOpenCensus={onOpenCensus}
        onLoadSample={onLoadSample}
      />
    </div>
  );
};
