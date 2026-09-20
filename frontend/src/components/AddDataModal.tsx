import React, { useEffect, useRef, useState } from 'react';
import {
  Package, Truck, Warehouse as WarehouseIcon, UploadCloud, AlertCircle,
  Sparkles, Flag, FileUp, X, Route
} from 'lucide-react';
import {
  Neighborhood, ValidationResult, DatasetSummary, VehicleType,
  Warehouse as WarehouseType, SyntheticConfig
} from '../types';
import {
  uploadFile, uploadDatasetFile, fetchSynthetic,
  fetchSyntheticVehicles, fetchSyntheticWarehouses,
  type ImportedAssignment
} from '../services/api';

export type AddDataset = 'orders' | 'vehicles' | 'warehouses' | 'assignments';

interface AddDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataset: AddDataset;
  center: { lat: number; lon: number } | null;
  onOrdersLoaded: (nodes: Neighborhood[], validation: ValidationResult, summary: DatasetSummary) => void;
  onVehiclesLoaded: (vehicles: VehicleType[], validation: ValidationResult, summary: any) => void;
  onWarehousesLoaded: (warehouses: WarehouseType[], validation: ValidationResult, summary: any) => void;
  onAssignmentsLoaded: (rows: ImportedAssignment[], validation: ValidationResult, summary: any) => void;
  onOrdersChange: (nodes: Neighborhood[]) => void;
  onVehiclesChange: (v: VehicleType[]) => void;
  onWarehousesChange: (w: WarehouseType[]) => void;
  onOpenCensus: () => void;
  onLoadSample: () => void;
}

const CITY_PRESETS = [
  { name: 'Hyderabad', lat: 17.385044, lon: 78.486671 },
  { name: 'Bengaluru', lat: 12.971598, lon: 77.594566 },
  { name: 'Mumbai', lat: 19.07609, lon: 72.877426 },
  { name: 'Delhi NCR', lat: 28.613939, lon: 77.209023 }
];

const FLEET_ROTATION = ['bike', 'van', 'truck', 'ev_van'];

const DATASET_META: Record<AddDataset, { title: string; subtitle: string; icon: React.ElementType }> = {
  orders: { title: 'Import orders', subtitle: 'Upload a CSV/JSON file or generate synthetic demand', icon: Package },
  vehicles: { title: 'Import vehicles', subtitle: 'Upload a fleet CSV/JSON file or generate vehicles', icon: Truck },
  warehouses: { title: 'Import warehouses', subtitle: 'Upload a sites CSV/JSON file or generate warehouses', icon: WarehouseIcon },
  assignments: { title: 'Import assignments', subtitle: 'Upload a neighborhood → warehouse plan (drawn on the map)', icon: Route }
};

/** Compact per-dataset upload dropzone (CSV/JSON). */
const DatasetDropzone: React.FC<{
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
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.[0]) handle(e.dataTransfer.files[0]);
      }}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
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
      <div className="w-12 h-12 mx-auto rounded-2xl bg-cream-deep text-ink flex items-center justify-center mb-2.5">
        <UploadCloud className="w-6 h-6" />
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
    <div className="space-y-3">
      <p className="text-[11px] text-ink-faint">City model: core + districts + hubs + fringe, orders taper from centre.</p>
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
    <div className="space-y-3">
      <p className="text-[11px] text-ink-faint">Deterministic rotation: bike → van → truck → ev_van, then seeded extras.</p>
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
    <div className="space-y-3">
      <p className="text-[11px] text-ink-faint">Seeded ring around the centre — doubles as the D-baseline + E keep set.</p>
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

/**
 * Add-data window: two tabs — drop a CSV/JSON file, or generate data.
 * Title and both tab bodies adapt to the dataset (order / vehicle / warehouse).
 */
export const AddDataModal: React.FC<AddDataModalProps> = ({
  isOpen, onClose, dataset, center,
  onOrdersLoaded, onVehiclesLoaded, onWarehousesLoaded, onAssignmentsLoaded,
  onOrdersChange, onVehiclesChange, onWarehousesChange,
  onOpenCensus, onLoadSample
}) => {
  const [tab, setTab] = useState<'upload' | 'generate'>('upload');

  // Always land on the Upload tab when the window (re)opens.
  useEffect(() => {
    if (isOpen) setTab('upload');
  }, [isOpen, dataset]);

  if (!isOpen) return null;

  const meta = DATASET_META[dataset];
  const MetaIcon = meta.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl border border-[#E4E1D2] shadow-2xl max-w-xl w-full p-6 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto nice-scroll">
        <div className="flex items-center justify-between pb-4 border-b border-[#E4E1D2] mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-cream-deep text-ink flex items-center justify-center">
              <MetaIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">{meta.title}</h3>
              <p className="text-xs text-ink-faint">{meta.subtitle}</p>
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

        <div className="flex items-center gap-1.5 p-1 rounded-full bg-cream-deep border border-[#E4E1D2] mb-4">
          {(
            [
              { id: 'upload', label: 'Upload file', icon: FileUp },
              { id: 'generate', label: 'Generate data', icon: Sparkles }
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold transition cursor-pointer ${
                  active ? 'bg-white shadow text-ink' : 'text-ink-faint hover:text-ink'
                }`}>
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {tab === 'upload' && dataset === 'orders' && (
          <DatasetDropzone
            hint={<span>Headers: <code className="bg-cream-deep px-1 rounded">neighborhood_id</code> <code className="bg-cream-deep px-1 rounded">latitude</code> <code className="bg-cream-deep px-1 rounded">longitude</code> <code className="bg-cream-deep px-1 rounded">daily_orders</code> (aliases: id / lat / lng / orders)</span>}
            onFile={async (file) => {
              const result = await uploadFile(file);
              onOrdersLoaded(result.neighborhoods, result.validation, result.summary);
              onClose();
            }}
          />
        )}
        {tab === 'upload' && dataset === 'vehicles' && (
          <DatasetDropzone
            hint={<span>Headers: <code className="bg-cream-deep px-1 rounded">vehicle_type</code> <code className="bg-cream-deep px-1 rounded">capacity</code> <code className="bg-cream-deep px-1 rounded">cost_per_km</code> <code className="bg-cream-deep px-1 rounded">fuel_type</code> (+ avg_speed_kmph, mileage_kmpl)</span>}
            onFile={async (file) => {
              const result = await uploadDatasetFile(file, 'vehicles');
              onVehiclesLoaded(result.vehicles || [], result.validation, result.summary);
              onClose();
            }}
          />
        )}
        {tab === 'upload' && dataset === 'warehouses' && (
          <DatasetDropzone
            hint={<span>Headers: <code className="bg-cream-deep px-1 rounded">warehouse_id</code> <code className="bg-cream-deep px-1 rounded">latitude</code> <code className="bg-cream-deep px-1 rounded">longitude</code> <code className="bg-cream-deep px-1 rounded">capacity / radius_km / infra_cost</code></span>}
            onFile={async (file) => {
              const result = await uploadDatasetFile(file, 'warehouses');
              onWarehousesLoaded(result.warehouses || [], result.validation, result.summary);
              onClose();
            }}
          />
        )}
        {tab === 'upload' && dataset === 'assignments' && (
          <DatasetDropzone
            hint={<span>Headers: <code className="bg-cream-deep px-1 rounded">neighborhood_id</code> <code className="bg-cream-deep px-1 rounded">warehouse_id</code> (aliases: node / warehouse / dist) + optional <code className="bg-cream-deep px-1 rounded">distance_km</code>. Unknown ids warn; one node → one warehouse.</span>}
            onFile={async (file) => {
              const result = await uploadDatasetFile(file, 'assignments');
              onAssignmentsLoaded(result.assignments || [], result.validation, result.summary);
              onClose();
            }}
          />
        )}
        {tab === 'generate' && dataset === 'assignments' && (
          <p className="text-xs text-ink-faint bg-cream-deep border border-[#E4E1D2] p-3 rounded-xl">
            Assignments come from your own plan — upload a file, or run Optimize to generate them automatically.
          </p>
        )}

        {tab === 'generate' && dataset === 'orders' && (
          <OrdersGenerator
            onGenerated={(nodes) => { onOrdersChange(nodes); onClose(); }}
            onOpenCensus={() => { onClose(); onOpenCensus(); }}
            onLoadSample={() => { onLoadSample(); onClose(); }}
          />
        )}
        {tab === 'generate' && dataset === 'vehicles' && (
          <VehiclesGenerator onGenerated={(v) => { onVehiclesChange(v); onClose(); }} />
        )}
        {tab === 'generate' && dataset === 'warehouses' && (
          <WarehousesGenerator center={center} onGenerated={(w) => { onWarehousesChange(w); onClose(); }} />
        )}
      </div>
    </div>
  );
};
