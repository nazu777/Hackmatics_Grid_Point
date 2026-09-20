import React from 'react';
import {
  Package, Truck, Warehouse as WarehouseIcon,
  FileSpreadsheet, FileJson, Download, X
} from 'lucide-react';
import {
  Neighborhood, VehicleType, Warehouse as WarehouseType
} from '../types';
import { exportCsv, exportJson } from '../services/api';
import { downloadFile } from './panelStore';

export type ExportDataset = 'orders' | 'vehicles' | 'warehouses';

interface ExportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataset: ExportDataset;
  neighborhoods: Neighborhood[];
  vehicles: VehicleType[];
  warehouses: WarehouseType[];
}

const DATASET_META: Record<ExportDataset, { title: string; subtitle: string; icon: React.ElementType; count: (d: ExportDataModalProps) => number }> = {
  orders: {
    title: 'Export orders', subtitle: 'Download the demand table as CSV or JSON',
    icon: Package, count: (d) => d.neighborhoods.length
  },
  vehicles: {
    title: 'Export vehicles', subtitle: 'Download the fleet table as CSV or JSON',
    icon: Truck, count: (d) => d.vehicles.length
  },
  warehouses: {
    title: 'Export warehouses', subtitle: 'Download the sites table as CSV or JSON',
    icon: WarehouseIcon, count: (d) => d.warehouses.length
  }
};

function vehiclesCsv(rows: VehicleType[]): string {
  const header = 'vehicle_type,capacity,cost_per_km,fuel_type,avg_speed_kmph,mileage_kmpl';
  const lines = rows.map((v) =>
    [v.vehicle_type, v.capacity, v.cost_per_km, v.fuel_type || 'petrol', v.avg_speed_kmph ?? 30, v.mileage_kmpl ?? ''].join(',')
  );
  return [header, ...lines].join('\n');
}

function warehousesCsv(rows: WarehouseType[]): string {
  const header = 'warehouse_id,latitude,longitude,capacity,radius_km,infra_cost';
  const lines = rows.map((w) =>
    [w.warehouse_id, w.latitude, w.longitude, w.capacity ?? '', w.radius_km ?? '', w.infra_cost ?? 0].join(',')
  );
  return [header, ...lines].join('\n');
}

/**
 * Export window mirroring the import window: two options — CSV or JSON —
 * for the active dataset (orders / vehicles / warehouses).
 */
export const ExportDataModal: React.FC<ExportDataModalProps> = (props) => {
  const { isOpen, onClose, dataset } = props;

  if (!isOpen) return null;

  const meta = DATASET_META[dataset];
  const MetaIcon = meta.icon;
  const count = meta.count(props);
  const empty = count === 0;

  const handleCsv = async () => {
    if (dataset === 'orders') {
      downloadFile('gridpoint_neighborhoods.csv', await exportCsv(props.neighborhoods));
    } else if (dataset === 'vehicles') {
      downloadFile('gridpoint_vehicles.csv', vehiclesCsv(props.vehicles));
    } else {
      downloadFile('gridpoint_warehouses.csv', warehousesCsv(props.warehouses));
    }
  };

  const handleJson = async () => {
    if (dataset === 'orders') {
      downloadFile('gridpoint_neighborhoods.json', await exportJson(props.neighborhoods), 'application/json');
    } else if (dataset === 'vehicles') {
      downloadFile('gridpoint_vehicles.json', JSON.stringify(props.vehicles, null, 2), 'application/json');
    } else {
      downloadFile('gridpoint_warehouses.json', JSON.stringify(props.warehouses, null, 2), 'application/json');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl border border-[#E4E1D2] shadow-2xl max-w-xl w-full p-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-[#E4E1D2] mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-cream-deep text-ink flex items-center justify-center">
              <MetaIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">{meta.title}</h3>
              <p className="text-xs text-ink-faint">{meta.subtitle} • {count} row{count === 1 ? '' : 's'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-xl text-ink-faint hover:text-ink hover:bg-cream-deep transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {empty ? (
          <p className="text-[13px] text-ink-faint text-center py-6">
            Nothing to export yet — import or generate data first.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={handleCsv}
              className="flex flex-col items-start gap-2 p-4 rounded-2xl border border-[#E4E1D2] hover:border-gold hover:bg-cream-deep/50 transition cursor-pointer text-left">
              <span className="w-9 h-9 rounded-xl bg-cream-deep flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5 text-ink" />
              </span>
              <span className="font-bold text-[13px] text-ink flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> CSV
              </span>
              <span className="text-[11px] text-ink-faint">Spreadsheet format — opens in Excel / Sheets.</span>
            </button>
            <button onClick={handleJson}
              className="flex flex-col items-start gap-2 p-4 rounded-2xl border border-[#E4E1D2] hover:border-gold hover:bg-cream-deep/50 transition cursor-pointer text-left">
              <span className="w-9 h-9 rounded-xl bg-cream-deep flex items-center justify-center">
                <FileJson className="w-5 h-5 text-ink" />
              </span>
              <span className="font-bold text-[13px] text-ink flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> JSON
              </span>
              <span className="text-[11px] text-ink-faint">Raw data — re-importable, keeps every field.</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
