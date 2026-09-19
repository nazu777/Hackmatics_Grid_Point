import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowDownWideNarrow, ListFilter, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Sidebar, type AppView } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { Dashboard } from './components/Dashboard';
import { SummaryCards } from './components/SummaryCards';
import { FileUploader } from './components/FileUploader';
import { DataTable } from './components/DataTable';
import { SyntheticModal } from './components/SyntheticModal';
import { ErrorDrawer } from './components/ErrorDrawer';
import { OptimizationPanel } from './components/OptimizationPanel';
import { MapVisualizer } from './components/MapVisualizer';
import { MapView } from './components/MapView';
import { ComparisonDashboard } from './components/ComparisonDashboard';
import { OptimizationControls } from './components/OptimizationControls';
import { ScenariosPanel } from './components/ScenariosPanel';
import { ZoneLegendEditor } from './components/ZoneLegendEditor';
import { ExportView } from './components/ExportView';
import { UsageDonut } from './components/UsageDonut';
import { useZoneColors } from './components/mapThemes';
import { Neighborhood, ValidationResult, DatasetSummary, OptimizationConfig, OptimizationResult, MapLayerOptions } from './types';
import { validateData, localValidate } from './services/api';

// Initial Hyderabad seed dataset per schema.md
const INITIAL_DATASET: Neighborhood[] = [
  { neighborhood_id: 'N001', name: 'Charminar / Old City', latitude: 17.361564, longitude: 78.474665, daily_orders: 240, zone: 'South' },
  { neighborhood_id: 'N002', name: 'Banjara Hills', latitude: 17.415560, longitude: 78.435740, daily_orders: 185, zone: 'Central' },
  { neighborhood_id: 'N003', name: 'Jubilee Hills', latitude: 17.431940, longitude: 78.407470, daily_orders: 210, zone: 'West' },
  { neighborhood_id: 'N004', name: 'Hitec City', latitude: 17.443500, longitude: 78.377200, daily_orders: 320, zone: 'West' },
  { neighborhood_id: 'N005', name: 'Gachibowli', latitude: 17.440080, longitude: 78.348910, daily_orders: 290, zone: 'West' },
  { neighborhood_id: 'N006', name: 'Madhapur', latitude: 17.448290, longitude: 78.391490, daily_orders: 260, zone: 'West' },
  { neighborhood_id: 'N007', name: 'Secunderabad', latitude: 17.439930, longitude: 78.498270, daily_orders: 170, zone: 'North' },
  { neighborhood_id: 'N008', name: 'Kukatpally', latitude: 17.494790, longitude: 78.399640, daily_orders: 225, zone: 'North-West' },
  { neighborhood_id: 'N009', name: 'Begumpet', latitude: 17.444060, longitude: 78.465480, daily_orders: 140, zone: 'Central' },
  { neighborhood_id: 'N010', name: 'Ameerpet', latitude: 17.437460, longitude: 78.448290, daily_orders: 195, zone: 'Central' }
];

const DEFAULT_CONFIG: OptimizationConfig = {
  K: 2,
  distance_metric: 'haversine',
  capacity_enabled: false,
  C_max: null,
  radius_enabled: false,
  R_max_km: null,
  cost_per_km: 1.0,
  fuel_cost_per_km: 0.0,
  infra_cost_per_warehouse: 0.0,
  traffic_factor: 0.0,
  vehicle_fleet: [],
  random_seed: 42,
  baseline_mode: 'centroid'
};

const API_BASE = (import.meta.env.VITE_API_URL as string) || '/api (same-origin)';

export const App: React.FC = () => {
  const [view, setView] = useState<AppView>('dashboard');
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>(() => {
    const saved = localStorage.getItem('gridpoint_neighborhoods');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return INITIAL_DATASET;
  });

  const [validation, setValidation] = useState<ValidationResult>(() => localValidate(neighborhoods));
  const [summary, setSummary] = useState<DatasetSummary>(() => computeSummary(neighborhoods));
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [isSyntheticModalOpen, setIsSyntheticModalOpen] = useState(false);
  const [isErrorDrawerOpen, setIsErrorDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWh, setSelectedWh] = useState<string | null>(null);
  const [tabSort, setTabSort] = useState<'id' | 'orders' | 'nodes'>('id');
  const tabStripRef = useRef<HTMLDivElement>(null);
  const optimizerRef = useRef<HTMLDivElement>(null);

  const [optimizationConfig, setOptimizationConfig] = useState<OptimizationConfig>(() => {
    const saved = localStorage.getItem('gridpoint_opt_config');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return DEFAULT_CONFIG;
  });

  const [mapLayerOptions, setMapLayerOptions] = useState<MapLayerOptions>({
    showBubbles: true,
    showLabels: true,
    basemap: 'osm',
    colorBy: 'demand'
  });

  const { zoneColors, setZoneColor, resetZoneColors } = useZoneColors();

  const handleConfigChange = (updated: OptimizationConfig) => {
    setOptimizationConfig(updated);
    localStorage.setItem('gridpoint_opt_config', JSON.stringify(updated));
  };

  function computeSummary(nodes: Neighborhood[]): DatasetSummary {
    if (!nodes || nodes.length === 0) {
      return {
        count: 0,
        total_orders: 0,
        avg_orders: 0,
        min_orders: 0,
        max_orders: 0,
        center: { lat: 0, lon: 0 },
        bounds: { min_lat: 0, max_lat: 0, min_lon: 0, max_lon: 0 }
      };
    }
    const orders = nodes.map(n => Number(n.daily_orders) || 0);
    const lats = nodes.map(n => Number(n.latitude) || 0);
    const lons = nodes.map(n => Number(n.longitude) || 0);
    const total = orders.reduce((acc, curr) => acc + curr, 0);

    return {
      count: nodes.length,
      total_orders: total,
      avg_orders: total / nodes.length,
      min_orders: Math.min(...orders),
      max_orders: Math.max(...orders),
      center: {
        lat: lats.reduce((a, b) => a + b, 0) / lats.length,
        lon: lons.reduce((a, b) => a + b, 0) / lons.length
      },
      bounds: {
        min_lat: Math.min(...lats),
        max_lat: Math.max(...lats),
        min_lon: Math.min(...lons),
        max_lon: Math.max(...lons)
      }
    };
  }

  const triggerValidation = useCallback(async (data: Neighborhood[]) => {
    setSummary(computeSummary(data));
    localStorage.setItem('gridpoint_neighborhoods', JSON.stringify(data));
    const res = await validateData(data);
    setValidation(res);
  }, []);

  useEffect(() => {
    triggerValidation(neighborhoods);
  }, [neighborhoods, triggerValidation]);

  useEffect(() => {
    if (optimizationResult && !selectedWh) {
      setSelectedWh(optimizationResult.warehouses[0]?.warehouse_id ?? null);
    }
    if (!optimizationResult) setSelectedWh(null);
  }, [optimizationResult, selectedWh]);

  const handleDataLoaded = (newNodes: Neighborhood[], valResult: ValidationResult, newSummary: DatasetSummary) => {
    setNeighborhoods(newNodes);
    setValidation(valResult);
    setSummary(newSummary);
    localStorage.setItem('gridpoint_neighborhoods', JSON.stringify(newNodes));
  };

  const handleSyntheticGenerated = (newNodes: Neighborhood[]) => {
    setNeighborhoods(newNodes);
    triggerValidation(newNodes);
  };

  const handleApplyZones = (updated: Neighborhood[]) => {
    setNeighborhoods(updated);
    triggerValidation(updated);
  };

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (q.trim()) setView('orders');
  };

  const handleDeleteResult = () => {
    if (window.confirm('Delete the current optimization result? Demand data is kept.')) {
      setOptimizationResult(null);
      setSelectedWh(null);
    }
  };

  const sortedWarehouses = React.useMemo(() => {
    const list = [...(optimizationResult?.warehouses ?? [])];
    if (tabSort === 'orders') list.sort((a, b) => (b.assigned_orders || 0) - (a.assigned_orders || 0));
    else if (tabSort === 'nodes') {
      const counts = new Map<string, number>();
      optimizationResult?.assignments.forEach((x) => counts.set(x.warehouse_id, (counts.get(x.warehouse_id) || 0) + 1));
      list.sort((a, b) => (counts.get(b.warehouse_id) || 0) - (counts.get(a.warehouse_id) || 0));
    } else list.sort((a, b) => a.warehouse_id.localeCompare(b.warehouse_id));
    return list;
  }, [optimizationResult, tabSort]);

  const clearLocalData = () => {
    if (!window.confirm('Reset all saved app data (demand, config, themes)?')) return;
    ['gridpoint_neighborhoods', 'gridpoint_opt_config', 'gridpoint_zone_colors'].forEach((k) => {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
    setNeighborhoods(INITIAL_DATASET);
    setOptimizationConfig(DEFAULT_CONFIG);
    setOptimizationResult(null);
    resetZoneColors();
  };

  return (
    <div className="min-h-screen bg-cream text-ink flex">
      <Sidebar view={view} onNavigate={setView} resultReady={!!optimizationResult} />

      <div className="flex-1 min-w-0 px-6 lg:px-8 pb-10 max-w-[1400px] mx-auto">
        <Topbar
          query={searchQuery}
          onQuery={handleSearch}
          errorCount={validation.errors.length}
          onOpenErrors={() => setIsErrorDrawerOpen(true)}
        />

        {/* ---------- DASHBOARD ---------- */}
        {view === 'dashboard' && (
          <Dashboard
            neighborhoods={neighborhoods}
            summary={summary}
            result={optimizationResult}
            selectedWh={selectedWh}
            onSelectWh={setSelectedWh}
            onAddRequest={() => setView('orders')}
            onEditSection={() => setView('warehouses')}
            onDeleteResult={handleDeleteResult}
            onRunOptimizer={() => setView('warehouses')}
          />
        )}

        {/* ---------- WAREHOUSES ---------- */}
        {view === 'warehouses' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display font-semibold text-[32px] text-ink leading-tight">
                Warehouses ({optimizationResult?.warehouses.length ?? optimizationConfig.K})
              </h2>
              <div className="flex items-center gap-2 text-[11px] font-semibold">
                <button
                  onClick={() => setTabSort((s) => (s === 'id' ? 'orders' : s === 'orders' ? 'nodes' : 'id'))}
                  title="Cycle tab sort: id → orders → nodes"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#E4E1D2] text-ink hover:border-gold transition cursor-pointer"
                >
                  <ArrowDownWideNarrow className="w-3.5 h-3.5" /> Sort: {tabSort}
                </button>
                <button
                  onClick={() => optimizerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#E4E1D2] text-ink hover:border-gold transition cursor-pointer"
                >
                  <ListFilter className="w-3.5 h-3.5" /> Optimizer
                </button>
              </div>
            </div>

            {/* Warehouse pill tabs */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => tabStripRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}
                className="w-9 h-9 shrink-0 rounded-full bg-white border border-[#E4E1D2] flex items-center justify-center text-ink hover:border-gold transition cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div ref={tabStripRef} className="flex gap-2 overflow-x-auto nice-scroll flex-1 py-0.5">
                {sortedWarehouses.length === 0 && (
                  <span className="text-xs text-ink-faint px-2 py-2">
                    No warehouses yet — configure K below and run the optimizer.
                  </span>
                )}
                {sortedWarehouses.map((w) => (
                  <button
                    key={w.warehouse_id}
                    onClick={() => setSelectedWh(w.warehouse_id)}
                    className={`px-8 py-2.5 rounded-full text-[13px] font-medium whitespace-nowrap transition cursor-pointer border ${
                      selectedWh === w.warehouse_id
                        ? 'bg-[#14424E] text-white border-[#14424E] font-semibold'
                        : 'bg-white text-ink border-[#E4E1D2] hover:border-gold'
                    }`}
                  >
                    Warehouse {w.warehouse_id.replace(/^W/i, '')}
                  </button>
                ))}
              </div>
              <button
                onClick={() => tabStripRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}
                className="w-9 h-9 shrink-0 rounded-full bg-white border border-[#E4E1D2] flex items-center justify-center text-ink hover:border-gold transition cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => optimizerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                title="New optimization run"
                className="w-9 h-9 shrink-0 rounded-full bg-[#14424E] flex items-center justify-center text-white hover:bg-pine-800 transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
              <div className="xl:col-span-2" ref={optimizerRef}>
                <OptimizationPanel
                  neighborhoods={neighborhoods}
                  onOptimizationComplete={setOptimizationResult}
                  lastResult={optimizationResult}
                  onGoToComparison={() => setView('shipments')}
                />
              </div>
              <div className="space-y-5">
                <UsageDonut
                  warehouses={optimizationResult?.warehouses ?? []}
                  assignments={optimizationResult?.assignments ?? []}
                  neighborhoods={neighborhoods}
                  selectedId={selectedWh}
                  capacityPerWarehouse={optimizationResult?.config.capacity_enabled ? (optimizationResult?.config.C_max ?? null) : null}
                />
              </div>
            </div>

            {optimizationResult && (
              <MapView
                neighborhoods={neighborhoods}
                warehouses={optimizationResult.warehouses}
                assignments={optimizationResult.assignments}
                radiusKm={optimizationResult.config.radius_enabled ? (optimizationResult.config.R_max_km ?? null) : null}
                basemap={mapLayerOptions.basemap}
                onBasemapChange={(b) => setMapLayerOptions((prev) => ({ ...prev, basemap: b }))}
                colorBy={mapLayerOptions.colorBy}
                onColorByChange={(c) => setMapLayerOptions((prev) => ({ ...prev, colorBy: c }))}
                zoneColors={zoneColors}
              />
            )}
          </div>
        )}

        {/* ---------- ORDERS (ingestion) ---------- */}
        {view === 'orders' && (
          <div className="space-y-5">
            <div>
              <h2 className="font-display font-semibold text-[32px] text-ink leading-tight">Orders ({neighborhoods.length})</h2>
              <p className="text-[13px] text-ink-faint mt-1">Demand intake — upload, generate or edit neighborhood orders. Search above filters this table.</p>
            </div>
            <FileUploader
              onDataLoaded={handleDataLoaded}
              onOpenSyntheticModal={() => setIsSyntheticModalOpen(true)}
            />
            <DataTable
              neighborhoods={neighborhoods}
              errors={validation.errors}
              onChange={(updated) => setNeighborhoods(updated)}
              externalQuery={searchQuery}
            />
          </div>
        )}

        {/* ---------- SHIPMENTS (assignments + comparison) ---------- */}
        {view === 'shipments' && (
          <div className="space-y-5">
            <div>
              <h2 className="font-display font-semibold text-[32px] text-ink leading-tight">Shipments</h2>
              <p className="text-[13px] text-ink-faint mt-1">Neighborhood → warehouse assignments and baseline vs optimized comparison.</p>
            </div>
            {optimizationResult ? (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                  <div className="lg:col-span-2">
                    <MapView
                      neighborhoods={neighborhoods}
                      warehouses={optimizationResult.warehouses}
                      assignments={optimizationResult.assignments}
                      radiusKm={optimizationResult.config.radius_enabled ? (optimizationResult.config.R_max_km ?? null) : null}
                      basemap={mapLayerOptions.basemap}
                      onBasemapChange={(b) => setMapLayerOptions((prev) => ({ ...prev, basemap: b }))}
                      colorBy={mapLayerOptions.colorBy}
                      onColorByChange={(c) => setMapLayerOptions((prev) => ({ ...prev, colorBy: c }))}
                      zoneColors={zoneColors}
                    />
                  </div>
                  <div className="lg:col-span-1">
                    <ZoneLegendEditor
                      neighborhoods={neighborhoods}
                      zoneColors={zoneColors}
                      onZoneColorChange={setZoneColor}
                      onResetZoneColors={resetZoneColors}
                      onApplyZones={handleApplyZones}
                      compact
                    />
                  </div>
                </div>
                <ComparisonDashboard result={optimizationResult} />
              </>
            ) : (
              <div className="card p-12 text-center">
                <h3 className="font-display text-xl font-semibold text-ink">No shipments yet</h3>
                <p className="text-xs text-ink-faint max-w-md mx-auto mt-2">
                  Run the optimizer in Warehouses first — assignment lines and cost comparison will appear here.
                </p>
                <button
                  onClick={() => setView('warehouses')}
                  className="mt-6 px-5 py-2 bg-pine-700 hover:bg-pine-800 text-white rounded-full text-xs font-bold transition cursor-pointer"
                >
                  Go to Warehouses &rarr;
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---------- INVENTORY (map + zones) ---------- */}
        {view === 'inventory' && (
          <div className="space-y-5">
            <div>
              <h2 className="font-display font-semibold text-[32px] text-ink leading-tight">Inventory</h2>
              <p className="text-[13px] text-ink-faint mt-1">Demand health, geographic stock map and zone themes.</p>
            </div>
            <SummaryCards
              summary={summary}
              validation={validation}
              onOpenErrors={() => setIsErrorDrawerOpen(true)}
            />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-1 space-y-4">
                <OptimizationControls
                  config={optimizationConfig}
                  onChange={handleConfigChange}
                  neighborhoods={neighborhoods}
                  onProceedToOptimization={() => setView('warehouses')}
                />
                <ZoneLegendEditor
                  neighborhoods={neighborhoods}
                  zoneColors={zoneColors}
                  onZoneColorChange={setZoneColor}
                  onResetZoneColors={resetZoneColors}
                  onApplyZones={handleApplyZones}
                  compact
                />
              </div>
              <div className="lg:col-span-2">
                <MapVisualizer
                  neighborhoods={neighborhoods}
                  layerOptions={mapLayerOptions}
                  setLayerOptions={setMapLayerOptions}
                  zoneColors={zoneColors}
                />
              </div>
            </div>
          </div>
        )}

        {/* ---------- TRACKING (scenarios) ---------- */}
        {view === 'tracking' && (
          <div className="space-y-5">
            <div>
              <h2 className="font-display font-semibold text-[32px] text-ink leading-tight">Tracking</h2>
              <p className="text-[13px] text-ink-faint mt-1">Demand scenarios, fleet ETA and what-if diagnostics.</p>
            </div>
            <ScenariosPanel
              neighborhoods={neighborhoods}
              config={optimizationConfig}
              lastResult={optimizationResult}
              onUpdateNeighborhoods={(updated) => {
                setNeighborhoods(updated);
                localStorage.setItem('gridpoint_neighborhoods', JSON.stringify(updated));
                setSummary(computeSummary(updated));
              }}
              onUpdateConfig={handleConfigChange}
              onOptimizationComplete={(res) => {
                setOptimizationResult(res);
              }}
              onGoToMap={() => setView('inventory')}
            />
          </div>
        )}

        {/* ---------- EXPORT ---------- */}
        {view === 'export' && (
          <ExportView neighborhoods={neighborhoods} result={optimizationResult} />
        )}

        {/* ---------- SETTINGS ---------- */}
        {view === 'settings' && (
          <div className="space-y-5 max-w-2xl">
            <h2 className="font-display font-semibold text-[32px] text-ink leading-tight">Settings</h2>
            <div className="card p-5 space-y-4">
              <div>
                <label className="text-xs font-bold text-ink block mb-1.5">Default map theme</label>
                <div className="flex gap-2">
                  {(['osm', 'positron', 'dark'] as const).map((b) => (
                    <button
                      key={b}
                      onClick={() => setMapLayerOptions((prev) => ({ ...prev, basemap: b }))}
                      className={`px-4 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
                        mapLayerOptions.basemap === b ? 'bg-[#14424E] text-white' : 'bg-cream-deep text-ink hover:bg-gold-100'
                      }`}
                    >
                      {b === 'osm' ? 'Standard' : b === 'positron' ? 'Light' : 'Dark'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-ink block mb-1.5">Default bubble coloring</label>
                <div className="flex gap-2">
                  {(['warehouse', 'zone', 'demand'] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setMapLayerOptions((prev) => ({ ...prev, colorBy: c }))}
                      className={`px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition cursor-pointer ${
                        mapLayerOptions.colorBy === c ? 'bg-[#14424E] text-white' : 'bg-cream-deep text-ink hover:bg-gold-100'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={resetZoneColors}
                  className="px-4 py-2 rounded-full bg-cream-deep text-ink text-xs font-bold hover:bg-gold-100 transition cursor-pointer"
                >
                  Reset zone colors
                </button>
                <button
                  onClick={clearLocalData}
                  className="px-4 py-2 rounded-full bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 transition cursor-pointer"
                >
                  Reset all saved data
                </button>
              </div>
              <p className="text-[11px] text-ink-faint pt-1">
                Backend: <span className="font-mono">{API_BASE}</span> • Schema v1.0.0 • GridPoint for HACK-A-MATICS
              </p>
            </div>
          </div>
        )}

        {/* ---------- HELP ---------- */}
        {view === 'help' && (
          <div className="space-y-5 max-w-3xl">
            <h2 className="font-display font-semibold text-[32px] text-ink leading-tight">Help Center</h2>
            <div className="grid gap-4">
              {[
                { t: '1. Load demand', d: 'Orders → upload CSV/JSON, generate synthetic clusters, or edit the table inline. Required columns: neighborhood_id, latitude, longitude, daily_orders.' },
                { t: '2. Explore geography', d: 'Inventory → demand map with Standard / Light / Dark themes; color bubbles by zone category or demand intensity.' },
                { t: '3. Place warehouses', d: 'Warehouses → set K (1–10), distance metric and constraints, then run Weiszfeld / weighted K-Means / MILP optimization.' },
                { t: '4. Ship & compare', d: 'Shipments → assignment lines on the map plus baseline-vs-optimized cost cards, histogram and CSV exports.' },
                { t: '5. What-if scenarios', d: 'Tracking → demand shifts, fleet ETA, elbow analysis and feasibility diagnostics.' }
              ].map((s) => (
                <div key={s.t} className="card p-5">
                  <h3 className="font-bold text-[15px] text-ink">{s.t}</h3>
                  <p className="text-[13px] text-ink-soft mt-1">{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <SyntheticModal
        isOpen={isSyntheticModalOpen}
        onClose={() => setIsSyntheticModalOpen(false)}
        onGenerated={handleSyntheticGenerated}
      />

      <ErrorDrawer
        isOpen={isErrorDrawerOpen}
        onClose={() => setIsErrorDrawerOpen(false)}
        errors={validation.errors}
        warnings={validation.warnings}
      />
    </div>
  );
};
