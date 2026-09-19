import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
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

export const App: React.FC = () => {
  const [activePhase, setActivePhase] = useState<number>(1);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>(() => {
    const saved = localStorage.getItem('gridpoint_neighborhoods');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return INITIAL_DATASET;
  });

  const [validation, setValidation] = useState<ValidationResult>(() => localValidate(neighborhoods));
  const [summary, setSummary] = useState<DatasetSummary>(() => computeSummary(neighborhoods));
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [isSyntheticModalOpen, setIsSyntheticModalOpen] = useState(false);
  const [isErrorDrawerOpen, setIsErrorDrawerOpen] = useState(false);

  // Phase 2 Config & Map Layer state
  const [optimizationConfig, setOptimizationConfig] = useState<OptimizationConfig>(() => {
    const saved = localStorage.getItem('gridpoint_opt_config');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
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

  // Compute summary stats
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

  // Auto-validate whenever neighborhoods change
  const triggerValidation = useCallback(async (data: Neighborhood[]) => {
    setSummary(computeSummary(data));
    localStorage.setItem('gridpoint_neighborhoods', JSON.stringify(data));
    const res = await validateData(data);
    setValidation(res);
  }, []);

  useEffect(() => {
    triggerValidation(neighborhoods);
  }, [neighborhoods, triggerValidation]);

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col">
      {/* Navbar */}
      <Header activePhase={activePhase} setActivePhase={setActivePhase} />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Metric Cards */}
        <SummaryCards
          summary={summary}
          validation={validation}
          onOpenErrors={() => setIsErrorDrawerOpen(true)}
        />

        {/* Phase 1 Main View */}
        {activePhase === 1 && (
          <div>
            <FileUploader
              onDataLoaded={handleDataLoaded}
              onOpenSyntheticModal={() => setIsSyntheticModalOpen(true)}
            />

            <DataTable
              neighborhoods={neighborhoods}
              errors={validation.errors}
              onChange={(updated) => setNeighborhoods(updated)}
            />
          </div>
        )}

        {/* Phase 2 Map Visualizer & Controls */}
        {activePhase === 2 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              {/* Left Column: Interactive Controls */}
              <div className="lg:col-span-1 space-y-4">
                <OptimizationControls
                  config={optimizationConfig}
                  onChange={handleConfigChange}
                  neighborhoods={neighborhoods}
                  onProceedToOptimization={() => setActivePhase(3)}
                />

                <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-3xl p-4 text-xs text-emerald-900 space-y-2">
                  <div className="font-bold flex items-center gap-1.5">
                    <span>Spatial Insights</span>
                  </div>
                  <p className="text-emerald-800">
                    The map plots circle markers scaled by daily orders. Hover or click on any node to view exact coordinates and demand intensity.
                  </p>
                  <button
                    onClick={() => setActivePhase(1)}
                    className="text-emerald-700 underline font-semibold hover:text-emerald-900 block pt-1"
                  >
                    &larr; Need to modify coordinates or orders? Edit in Phase 1
                  </button>
                </div>

                <ZoneLegendEditor
                  neighborhoods={neighborhoods}
                  zoneColors={zoneColors}
                  onZoneColorChange={setZoneColor}
                  onResetZoneColors={resetZoneColors}
                  onApplyZones={handleApplyZones}
                  compact
                />
              </div>

              {/* Right Column: Leaflet Map */}
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

        {/* Phase 3 Optimization */}
        {activePhase === 3 && (
          <OptimizationPanel
            neighborhoods={neighborhoods}
            onOptimizationComplete={setOptimizationResult}
            lastResult={optimizationResult}
            onGoToComparison={() => setActivePhase(4)}
          />
        )}

        {/* Phase 4: Cost Comparison Dashboard */}
        {activePhase === 4 && (
          <div className="space-y-6">
            {optimizationResult ? (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
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
              <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-sm my-8">
                <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
                  📈
                </div>
                <h3 className="text-xl font-bold text-slate-800">Phase 4: Delivery Cost Comparison</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-2">
                  No optimization result yet. Run the optimizer in <strong>Phase 3</strong> first — the baseline vs optimized dashboard, distance histogram, map overlay and CSV exports will appear here.
                </p>
                <button
                  onClick={() => setActivePhase(3)}
                  className="mt-6 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Go to Phase 3 Optimizer &rarr;
                </button>
              </div>
            )}
          </div>
        )}
        {/* Phase 5: Advanced Scenarios & Bonus Features */}
        {activePhase === 5 && (
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
            onGoToMap={() => setActivePhase(2)}
          />
        )}

      </main>

      {/* Synthetic Dataset Configuration Modal */}
      <SyntheticModal
        isOpen={isSyntheticModalOpen}
        onClose={() => setIsSyntheticModalOpen(false)}
        onGenerated={handleSyntheticGenerated}
      />

      {/* Validation Error Diagnostics Drawer */}
      <ErrorDrawer
        isOpen={isErrorDrawerOpen}
        onClose={() => setIsErrorDrawerOpen(false)}
        errors={validation.errors}
        warnings={validation.warnings}
      />

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <div>
            GRIDPOINT Decision-Support Engine &bull; Built for HACK-A-MATICS
          </div>
          <div className="flex items-center space-x-4">
            <span>Tech Stack: React + FastAPI + Pandas</span>
            <span>Schema v1.0.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
