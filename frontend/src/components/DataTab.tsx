import React, { useRef, useState } from 'react';
import {
  Package, Truck, Warehouse as WarehouseIcon, UploadCloud, AlertCircle,
  Sparkles, Flag, Database
} from 'lucide-react';
import {
  Neighborhood, ValidationResult, DatasetSummary, VehicleType,
  Warehouse as WarehouseType, SyntheticConfig, ZoneColorMap
} from '../types';
import {
  uploadFile, uploadDatasetFile, fetchSynthetic,
  fetchSyntheticVehicles, fetchSyntheticWarehouses
} from '../services/api';
import { DataTable } from './DataTable';
import { VehicleTable } from './VehicleTable';
import { WarehouseTable } from './WarehouseTable';
import { ZoneLegendEditor } from './ZoneLegendEditor';

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
  zoneColors: ZoneColorMap;
  onOrdersChange: (nodes: Neighborhood[]) => void;
  onVehiclesChange: (v: VehicleType[]) => void;
  onWarehousesChange: (w: WarehouseType[]) => void;
  onOrdersLoaded: (nodes: Neighborhood[], validation: ValidationResult, summary: DatasetSummary) => void;
  onVehiclesLoaded: (vehicles: VehicleType[], validation: ValidationResult, summary: any) => void;
  onWarehousesLoaded: (warehouses: WarehouseType[], validation: ValidationResult, summary: any) => void;
  onOpenCensus: () => void;
  onLoadSample: () => void;
  onZoneColorChange: (zone: string, color: string) => void;
  onResetZoneColors: () => void;
  onApplyZones: (updated: Neighborhood[]) => void;
}

const CITY_PRESETS = [
  { name: 'Hyderabad', lat: 17.385044, lon: 78.486671 },
  { name: 'Bengaluru', lat: 12.971598, lon: 77.594566 },
  { name: 'Mumbai', lat: 19.07609, lon: 72.877426 },
  { name: 'Delhi NCR', lat: 28.613939, lon: 77.209023 }
];

const FLEET_ROTATION = ['bike', 'van', 'truck', 'ev_van'];

/** Compact per-dataset upload dropzone (CSV/JSON). */
const DatasetDropzone: React.FC<{
  dataset: 'neighborhoods' | 'vehicles' | 'warehouses';
  hint: React.ReactNode;
  onFile: (file: File) => Promise<void>;
}> = ({ hint, onFile }) => {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      await onFile(file);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.[0]) handle(e.dataTransfer.files[0]);
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-all ${
          dragging ? 'border-[#14424E] bg-cream-deep' : 'border-[#E4E1D2] hover:border-gold'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.json,.txt"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handle(e.target.files[0]); }}
        />
        <div className="w-10 h-10 mx-auto rounded-2xl bg-cream-deep text-ink flex items-center justify-center mb-2">
          <UploadCloud className="w-5 h-5" />
        </div>
        <h4 className="text-[13px] font-semibold text-ink">
          {busy ? 'Parsing & validating…' : 'Drop CSV or JSON here, or click to browse'}
        </h4>
        <p className="text-[11px] text-ink-faint max-w-md mx-auto mt-1">{hint}</p>
        {error && (
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-medium border border-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};

/** Orders synthetic generator — city-model controls (N, distribution, spread, clusters, order range, seed). */
const OrdersGenerator: React.FC<{
  onGenerated: (nodes: Neighborhood[]) => void;
  onOpenCensus: () => void;
  onLoadSample: () => void;
}> = ({ onGenerated, onOpenCensus, onLoadSample }) => {
  const [config, setConfig] = useState<SyntheticConfig>({
    N: 35, lat_center: 17.385044, lon_center: 78.486671, spread_km: 20.0,
    distribution: 'clustered', num_clusters: 3, orders_min: 20, orders_max: 250, seed: 42
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (config.orders_min > config.orders_max) {
      setError('Min orders cannot exceed max orders.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      onGenerated(await fetchSynthetic(config));
    } catch (err: any) {
      setError(err.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-cream-deep flex items-center justify-center">
          <Package className="w-4 h-4 text-ink" />
        </span>
        <div>
          <h3 className="font-bold text-[13px] text-ink">Generate order demand</h3>
          <p className="text-[11px] text-ink-faint">City model: core + districts + hubs + fringe, orders taper from centre</p>
        </div>
      </div>
      <div>
        <label className="text-[11px] font-semibold text-ink-soft block mb-1.5">City preset</label>
        <div className="grid grid-cols-4 gap-1.5">
          {CITY_PRESETS.map((p) => (
            <button key={p.name} type="button"
              onClick={() => setConfig((c) => ({ ...c, lat_center: p.lat, lon_center: p.lon }))}
              className={`px-2 py-1.5 rounded-full text-[11px] font-medium border transition text-center cursor-pointer ${
                Math.abs(config.lat_center - p.lat) < 0.001
                  ? 'border-[#14424E] bg-grape-100 text-grape-600 font-semibold'
                  : 'border-[#E4E1D2] text-ink-soft hover:bg-cream-deep'
              }`}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="font-semibold text-ink-soft text-[11px]">Nodes (N)</span>
            <span className="font-mono font-bold">{config.N}</span>
          </div>
          <input type="range" min="5" max="500" step="5" value={config.N}
            onChange={(e) => setConfig({ ...config, N: parseInt(e.target.value) })} className="slider" />
        </div>
        <div>
          <label className="font-semibold text-ink-soft block mb-1 text-[11px]">Distribution</label>
          <select value={config.distribution}
            onChange={(e) => setConfig({ ...config, distribution: e.target.value as any })}
            className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2 py-1.5 text-xs focus:outline-none focus:border-gold">
            <option value="clustered">City mix (core + districts + hubs)</option>
            <option value="uniform">Uniform sprawl</option>
            <option value="gaussian">Dense core</option>
          </select>
        </div>
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="font-semibold text-ink-soft text-[11px]">Clusters</span>
            <span className="font-mono">{config.distribution === 'clustered' ? config.num_clusters : 'N/A'}</span>
          </div>
          <input type="range" min="1" max="8" disabled={config.distribution !== 'clustered'}
            value={config.num_clusters}
            onChange={(e) => setConfig({ ...config, num_clusters: parseInt(e.target.value) })}
            className="slider disabled:opacity-40" />
        </div>
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="font-semibold text-ink-soft text-[11px]">Spread</span>
            <span className="font-mono">{config.spread_km} km</span>
          </div>
          <input type="range" min="5" max="80" step="2.5" value={config.spread_km}
            onChange={(e) => setConfig({ ...config, spread_km: parseFloat(e.target.value) })} className="slider" />
        </div>
        <div>
          <label className="font-semibold text-ink-soft block mb-1 text-[11px]">Min orders</label>
          <input type="number" min="0" value={config.orders_min}
            onChange={(e) => setConfig({ ...config, orders_min: parseInt(e.target.value) || 0 })}
            className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-gold" />
        </div>
        <div>
          <label className="font-semibold text-ink-soft block mb-1 text-[11px]">Max orders</label>
          <input type="number" min="1" value={config.orders_max}
            onChange={(e) => setConfig({ ...config, orders_max: parseInt(e.target.value) || 100 })}
            className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-gold" />
        </div>
        <div className="col-span-2">
          <label className="font-semibold text-ink-soft block mb-1 text-[11px]">Seed (reproducibility)</label>
          <input type="number" value={config.seed}
            onChange={(e) => setConfig({ ...config, seed: parseInt(e.target.value) || 42 })}
            className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-gold" />
        </div>
      </div>
      {error && <p className="text-rose-600 text-xs font-medium">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={generate} disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer disabled:opacity-50">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{loading ? 'Generating…' : `Generate ${config.N} nodes`}</span>
        </button>
        <button onClick={onOpenCensus}
          className="flex items-center gap-1.5 px-4 py-2 bg-white border border-[#E4E1D2] hover:border-gold text-ink rounded-full text-xs font-bold transition cursor-pointer">
          <Flag className="w-3.5 h-3.5" />
          <span>US Census city</span>
        </button>
        <button onClick={onLoadSample}
          className="px-4 py-2 bg-cream-deep hover:bg-gold-100 text-ink rounded-full text-xs font-bold transition cursor-pointer">
          Hyderabad sample
        </button>
      </div>
    </div>
  );
};

/** Vehicles synthetic generator — fleet-size + seed + composition preview (distinct from orders). */
const VehiclesGenerator: React.FC<{ onGenerated: (v: VehicleType[]) => void }> = ({ onGenerated }) => {
  const [count, setCount] = useState(4);
  const [seed, setSeed] = useState(42);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = Array.from({ length: count }, (_, i) => FLEET_ROTATION[i % FLEET_ROTATION.length]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      onGenerated(await fetchSyntheticVehicles(seed, count));
    } catch (err: any) {
      setError(err.message || 'Fleet generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-cream-deep flex items-center justify-center">
          <Truck className="w-4 h-4 text-ink" />
        </span>
        <div>
          <h3 className="font-bold text-[13px] text-ink">Generate fleet</h3>
          <p className="text-[11px] text-ink-faint">Deterministic rotation: bike → van → truck → ev_van, then seeded extras</p>
        </div>
      </div>
      <div>
        <div className="flex justify-between items-center mb-1 text-xs">
          <span className="font-semibold text-ink-soft">Fleet size</span>
          <span className="font-mono font-bold">{count} vehicles</span>
        </div>
        <input type="range" min="1" max="12" value={count}
          onChange={(e) => setCount(parseInt(e.target.value))} className="slider" />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {preview.map((t, i) => (
            <span key={i} className="px-2.5 py-1 rounded-full bg-cream-deep text-ink-soft text-[11px] font-mono font-semibold">
              {i + 1}. {t}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="col-span-1">
          <label className="font-semibold text-ink-soft block mb-1 text-[11px]">Seed</label>
          <input type="number" value={seed}
            onChange={(e) => setSeed(parseInt(e.target.value) || 42)}
            className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-gold" />
        </div>
        <div className="col-span-1 flex items-end">
          <p className="text-[11px] text-ink-faint">Each type carries capacity, ₹/km, fuel, speed & mileage.</p>
        </div>
      </div>
      {error && <p className="text-rose-600 text-xs font-medium">{error}</p>}
      <button onClick={generate} disabled={loading}
        className="flex items-center gap-1.5 px-4 py-2 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer disabled:opacity-50">
        <Sparkles className="w-3.5 h-3.5" />
        <span>{loading ? 'Generating…' : `Generate ${count} vehicles (seed=${seed})`}</span>
      </button>
    </div>
  );
};

/** Warehouses synthetic generator — site-count + seed + map-centre controls (distinct from the other two). */
const WarehousesGenerator: React.FC<{
  center: { lat: number; lon: number } | null;
  onGenerated: (w: WarehouseType[]) => void;
}> = ({ center, onGenerated }) => {
  const [count, setCount] = useState(2);
  const [seed, setSeed] = useState(42);
  const [lat, setLat] = useState(center?.lat ?? 17.385044);
  const [lon, setLon] = useState(center?.lon ?? 78.486671);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      onGenerated(await fetchSyntheticWarehouses(seed, count, lat, lon));
    } catch (err: any) {
      setError(err.message || 'Site generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-cream-deep flex items-center justify-center">
          <WarehouseIcon className="w-4 h-4 text-ink" />
        </span>
        <div>
          <h3 className="font-bold text-[13px] text-ink">Generate existing sites</h3>
          <p className="text-[11px] text-ink-faint">Seeded ring around the centre — doubles as the D-baseline + E keep set</p>
        </div>
      </div>
      <div>
        <div className="flex justify-between items-center mb-1 text-xs">
          <span className="font-semibold text-ink-soft">Site count</span>
          <span className="font-mono font-bold">{count} sites</span>
        </div>
        <input type="range" min="1" max="6" value={count}
          onChange={(e) => setCount(parseInt(e.target.value))} className="slider" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <label className="font-semibold text-ink-soft block mb-1 text-[11px]">Centre lat</label>
          <input type="number" step="0.000001" value={lat}
            onChange={(e) => setLat(parseFloat(e.target.value) || 0)}
            className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-gold" />
        </div>
        <div>
          <label className="font-semibold text-ink-soft block mb-1 text-[11px]">Centre lon</label>
          <input type="number" step="0.000001" value={lon}
            onChange={(e) => setLon(parseFloat(e.target.value) || 0)}
            className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-gold" />
        </div>
        <div>
          <label className="font-semibold text-ink-soft block mb-1 text-[11px]">Seed</label>
          <input type="number" value={seed}
            onChange={(e) => setSeed(parseInt(e.target.value) || 42)}
            className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-gold" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {CITY_PRESETS.map((p) => (
          <button key={p.name} type="button" onClick={() => { setLat(p.lat); setLon(p.lon); }}
            className="px-2 py-1.5 rounded-full text-[11px] font-medium border border-[#E4E1D2] text-ink-soft hover:bg-cream-deep transition text-center cursor-pointer">
            {p.name}
          </button>
        ))}
      </div>
      {error && <p className="text-rose-600 text-xs font-medium">{error}</p>}
      <button onClick={generate} disabled={loading}
        className="flex items-center gap-1.5 px-4 py-2 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer disabled:opacity-50">
        <Sparkles className="w-3.5 h-3.5" />
        <span>{loading ? 'Generating…' : `Generate ${count} sites (seed=${seed})`}</span>
      </button>
    </div>
  );
};

export const DataTab: React.FC<DataTabProps> = (props) => {
  const {
    neighborhoods, vehicles, warehouses,
    ordersValidation, vehiclesValidation, warehousesValidation,
    summary, center, zoneColors,
    onOrdersChange, onVehiclesChange, onWarehousesChange,
    onOrdersLoaded, onVehiclesLoaded, onWarehousesLoaded,
    onOpenCensus, onLoadSample,
    onZoneColorChange, onResetZoneColors, onApplyZones
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
            <div className="min-w-0">
              <p className="font-bold text-[13px] text-ink">
                {neighborhoods.length} nodes • {summary.total_orders.toLocaleString()} daily orders
              </p>
              <p className="text-[11px] text-ink-faint">
                {ordersValidation.valid
                  ? 'All rows valid — ready to optimize.'
                  : `${ordersValidation.errors.length} validation issue${ordersValidation.errors.length === 1 ? '' : 's'} — see table.`}
              </p>
            </div>
          </div>
          <OrdersGenerator
            onGenerated={(nodes) => onOrdersChange(nodes)}
            onOpenCensus={onOpenCensus}
            onLoadSample={onLoadSample}
          />
          <div className="card p-4">
            <h3 className="text-[13px] font-bold text-ink mb-2">Upload orders</h3>
            <DatasetDropzone
              dataset="neighborhoods"
              hint={<span>Headers: <code className="bg-cream-deep px-1 rounded">neighborhood_id</code> <code className="bg-cream-deep px-1 rounded">latitude</code> <code className="bg-cream-deep px-1 rounded">longitude</code> <code className="bg-cream-deep px-1 rounded">daily_orders</code> (aliases: id / lat / lng / orders)</span>}
              onFile={async (file) => {
                const result = await uploadFile(file);
                onOrdersLoaded(result.neighborhoods, result.validation, result.summary);
              }}
            />
          </div>
          {neighborhoods.length === 0 && (
            <div className="card p-5 text-center border-dashed">
              <p className="font-bold text-sm text-ink">No order data yet</p>
              <p className="text-[12.5px] text-ink-soft mt-1">
                Generate a synthetic city, seed a Census city, upload a CSV — or start from the Hyderabad sample.
              </p>
            </div>
          )}
          <DataTable neighborhoods={neighborhoods} errors={ordersValidation.errors} onChange={onOrdersChange} externalQuery="" />
          <ZoneLegendEditor
            neighborhoods={neighborhoods}
            zoneColors={zoneColors}
            onZoneColorChange={onZoneColorChange}
            onResetZoneColors={onResetZoneColors}
            onApplyZones={onApplyZones}
            compact
          />
        </div>
      )}

      {subtab === 'vehicles' && (
        <div className="space-y-4">
          <div className="card p-4">
            <p className="font-bold text-[13px] text-ink">{vehicles.length} vehicles in fleet</p>
            <p className="text-[11px] text-ink-faint">
              {vehiclesValidation.valid || vehicles.length === 0
                ? 'Fleet feeds per-km cost, ETA and fuel math at optimize time.'
                : `${vehiclesValidation.errors.length} validation issue${vehiclesValidation.errors.length === 1 ? '' : 's'} — see table.`}
            </p>
          </div>
          <VehiclesGenerator onGenerated={(v) => onVehiclesChange(v)} />
          <div className="card p-4">
            <h3 className="text-[13px] font-bold text-ink mb-2">Upload fleet</h3>
            <DatasetDropzone
              dataset="vehicles"
              hint={<span>Headers: <code className="bg-cream-deep px-1 rounded">vehicle_type</code> <code className="bg-cream-deep px-1 rounded">capacity</code> <code className="bg-cream-deep px-1 rounded">cost_per_km</code> <code className="bg-cream-deep px-1 rounded">fuel_type</code> (+ avg_speed_kmph, mileage_kmpl)</span>}
              onFile={async (file) => {
                const result = await uploadDatasetFile(file, 'vehicles');
                onVehiclesLoaded(result.vehicles || [], result.validation, result.summary);
              }}
            />
          </div>
          <VehicleTable vehicles={vehicles} errors={vehiclesValidation.errors} onChange={onVehiclesChange} externalQuery="" />
        </div>
      )}

      {subtab === 'warehouses' && (
        <div className="space-y-4">
          <div className="card p-4">
            <p className="font-bold text-[13px] text-ink">{warehouses.length} existing sites</p>
            <p className="text-[11px] text-ink-faint">
              {(warehousesValidation.valid || warehouses.length === 0)
                ? 'Doubles as the D-baseline + E keep/abandon set.'
                : `${warehousesValidation.errors.length} validation issue${warehousesValidation.errors.length === 1 ? '' : 's'} — see table.`}
            </p>
          </div>
          <WarehousesGenerator center={center} onGenerated={(w) => onWarehousesChange(w)} />
          <div className="card p-4">
            <h3 className="text-[13px] font-bold text-ink mb-2">Upload sites</h3>
            <DatasetDropzone
              dataset="warehouses"
              hint={<span>Headers: <code className="bg-cream-deep px-1 rounded">warehouse_id</code> <code className="bg-cream-deep px-1 rounded">latitude</code> <code className="bg-cream-deep px-1 rounded">longitude</code> <code className="bg-cream-deep px-1 rounded">capacity / radius_km / infra_cost</code></span>}
              onFile={async (file) => {
                const result = await uploadDatasetFile(file, 'warehouses');
                onWarehousesLoaded(result.warehouses || [], result.validation, result.summary);
              }}
            />
          </div>
          <WarehouseTable warehouses={warehouses} errors={warehousesValidation.errors} onChange={onWarehousesChange} externalQuery="" center={center} />
        </div>
      )}
    </div>
  );
};
