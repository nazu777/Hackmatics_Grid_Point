import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, Plus, Download } from 'lucide-react';
import { GmapsRail, type RailTab } from './components/GmapsRail';
import { AskPanel } from './components/AskPanel';
import { DetailCard } from './components/DetailCard';
import { SavedPanel } from './components/SavedPanel';
import { MapChips, ResultRows, type LayerFlags } from './components/MapChrome';
import { MapView, type MapFocus } from './components/MapView';
import { OptimizationPanel } from './components/OptimizationPanel';
import { ComparisonDashboard } from './components/ComparisonDashboard';
import { DataTable } from './components/DataTable';
import { FileUploader } from './components/FileUploader';
import { SyntheticModal } from './components/SyntheticModal';
import { ErrorDrawer } from './components/ErrorDrawer';
import { ScenariosPanel } from './components/ScenariosPanel';
import { ZoneLegendEditor } from './components/ZoneLegendEditor';
import { ExportView } from './components/ExportView';
import { SettingsView } from './components/SettingsView';
import { useZoneColors } from './components/mapThemes';
import type { ThemeMode } from './components/Topbar';
import {
  buildAssignmentsCsv,
  buildMetricsCsv,
  downloadFile,
  pushRecent,
  searchNeighborhoods
} from './components/panelStore';
import { Neighborhood, ValidationResult, DatasetSummary, OptimizationConfig, OptimizationResult, MapLayerOptions, BasemapStyle } from './types';
import { validateData, localValidate, optimizeNetwork, exportCsv } from './services/api';

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

type PanelMode = RailTab | 'results' | 'detail';

export const App: React.FC = () => {
  const [panel, setPanel] = useState<PanelMode>('ask');
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
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try { return (localStorage.getItem('gridpoint-theme') as ThemeMode) || 'dark'; } catch { return 'dark'; }
  });
  const prevBasemap = useRef<BasemapStyle | null>(null);

  // Search / detail state (gmaps place flow)
  const [searchText, setSearchText] = useState('');
  const [resultNodes, setResultNodes] = useState<Neighborhood[]>([]);
  const [resultTitle, setResultTitle] = useState('');
  const [detailNode, setDetailNode] = useState<Neighborhood | null>(null);
  const [detailBack, setDetailBack] = useState<PanelMode>('ask');
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Map layer chips
  const [layers, setLayers] = useState<LayerFlags>({ warehouses: true, routes: true, demand: true, radius: true });

  // Resizable sidebar (drag the right edge; width persisted)
  const SIDEBAR_MIN = 280;
  const SIDEBAR_MAX = 640;
  const SIDEBAR_DEFAULT = 400;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem('gridpoint_sidebar_width') || '', 10);
      if (Number.isFinite(v)) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, v));
    } catch { /* ignore */ }
    return SIDEBAR_DEFAULT;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  const startSidebarResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent | PointerEvent) => {
      const max = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN + 40, window.innerWidth - 320));
      const w = Math.min(max, Math.max(SIDEBAR_MIN, startW + ev.clientX - startX));
      sidebarWidthRef.current = w;
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove as EventListener);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointermove', onMove as EventListener);
      window.removeEventListener('pointerup', onUp);
      try {
        localStorage.setItem('gridpoint_sidebar_width', String(Math.round(sidebarWidthRef.current)));
      } catch { /* ignore */ }
    };
    window.addEventListener('mousemove', onMove as EventListener);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('pointermove', onMove as EventListener);
    window.addEventListener('pointerup', onUp);
  }, []);
  const resetSidebarWidth = useCallback(() => {
    sidebarWidthRef.current = SIDEBAR_DEFAULT;
    setSidebarWidth(SIDEBAR_DEFAULT);
    try {
      localStorage.setItem('gridpoint_sidebar_width', String(SIDEBAR_DEFAULT));
    } catch { /* ignore */ }
  }, []);

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
    basemap: 'dark',
    colorBy: 'warehouse'
  });

  const { zoneColors, setZoneColor, resetZoneColors } = useZoneColors();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('gridpoint-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const handleThemeChange = (t: ThemeMode) => {
    setTheme(t);
    setMapLayerOptions((prev) => {
      if (t === 'dark') {
        prevBasemap.current = prev.basemap;
        return { ...prev, basemap: 'dark' as BasemapStyle };
      }
      const back = prevBasemap.current && prevBasemap.current !== 'dark' ? prevBasemap.current : ('osm' as BasemapStyle);
      return { ...prev, basemap: back };
    });
  };

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

  // ---- Ask actions ----
  const runOptimize = useCallback(async (k: number): Promise<OptimizationResult | null> => {
    try {
      const res = await optimizeNetwork(neighborhoods, { ...optimizationConfig, K: k });
      setOptimizationResult(res);
      setHighlightId(null);
      return res;
    } catch {
      return null;
    }
  }, [neighborhoods, optimizationConfig]);

  const handleExportDataset = useCallback(async () => {
    downloadFile('gridpoint_neighborhoods.csv', await exportCsv(neighborhoods));
  }, [neighborhoods]);

  const handleExportComparison = useCallback(() => {
    if (optimizationResult) downloadFile('gridpoint_metrics_comparison.csv', buildMetricsCsv(optimizationResult));
  }, [optimizationResult]);

  // ---- Search / detail flow ----
  const openDetail = useCallback((node: Neighborhood, back: PanelMode = 'ask') => {
    setDetailNode(node);
    setDetailBack(back);
    setPanel('detail');
    setHighlightId(node.neighborhood_id);
    setFocus({ lat: node.latitude, lon: node.longitude, zoom: 14, key: Date.now() });
  }, []);

  const submitSearch = (q: string) => {
    const query = q.trim();
    if (!query) return;
    pushRecent(query);
    const hits = searchNeighborhoods(neighborhoods, query);
    if (hits.length === 1) openDetail(hits[0], 'ask');
    else {
      setResultNodes(hits.slice(0, 30));
      setResultTitle(hits.length ? `${hits.length} matches for “${query}”` : `No matches for “${query}”`);
      setPanel('results');
    }
  };

  const demandRank = (node: Neighborhood): number | null => {
    const sorted = [...neighborhoods].sort((a, b) => Number(b.daily_orders) - Number(a.daily_orders));
    const i = sorted.findIndex((n) => n.neighborhood_id === node.neighborhood_id);
    return i >= 0 ? i + 1 : null;
  };

  const toggleLayer = (key: keyof LayerFlags) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  const railTab: RailTab =
    panel === 'results' || panel === 'detail' ? 'ask' : (panel as RailTab);

  const today = new Date().toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const kCount = optimizationResult?.warehouses.length ?? optimizationConfig.K;

  return (
    <div className="relative h-screen w-screen flex overflow-hidden bg-cream text-ink">
      <GmapsRail tab={railTab} onTab={setPanel} theme={theme} onThemeChange={handleThemeChange} />

      {/* Floating panel — overlays the full-bleed map, never pushes it */}
      <aside
        style={{ width: sidebarWidth, left: 76 + 16, top: 16, bottom: 16 }}
        className="absolute z-20 bg-white border border-[#E4E1D2] rounded-3xl shadow-xl shadow-black/10 overflow-y-auto nice-scroll"
      >
        {panel === 'ask' && (
          <AskPanel
            neighborhoods={neighborhoods}
            config={optimizationConfig}
            result={optimizationResult}
            onOptimize={runOptimize}
            onOpenCompare={() => setPanel('compare')}
            onApplyZones={handleApplyZones}
            onExportDataset={handleExportDataset}
            onExportComparison={handleExportComparison}
            onOpenDetail={(n) => openDetail(n, 'ask')}
            onShowResults={(nodes, title) => {
              setResultNodes(nodes);
              setResultTitle(title);
              setPanel('results');
            }}
          />
        )}

        {panel === 'results' && (
          <ResultRows
            nodes={resultNodes}
            title={resultTitle}
            onOpen={(n) => openDetail(n, 'results')}
            onClose={() => setPanel('ask')}
          />
        )}

        {panel === 'detail' && detailNode && (
          <DetailCard
            node={detailNode}
            allNodes={neighborhoods}
            assignment={optimizationResult?.assignments.find((a) => a.neighborhood_id === detailNode.neighborhood_id) ?? null}
            demandRank={demandRank(detailNode)}
            onBack={() => setPanel(detailBack)}
            onCenter={(n) => {
              setHighlightId(n.neighborhood_id);
              setFocus({ lat: n.latitude, lon: n.longitude, zoom: 14, key: Date.now() });
            }}
            onOpenDetail={(n) => openDetail(n, 'detail')}
            zoneColors={zoneColors}
          />
        )}

        {panel === 'saved' && (
          <SavedPanel
            neighborhoods={neighborhoods}
            result={optimizationResult}
            zoneColors={zoneColors}
            onLoadList={(nodes) => {
              setNeighborhoods(nodes);
              triggerValidation(nodes);
              setPanel('ask');
            }}
            onLoadResult={(res) => {
              setOptimizationResult(res);
              setPanel('compare');
            }}
          />
        )}

        {panel === 'optimize' && (
          <div className="p-4">
            <OptimizationPanel
              neighborhoods={neighborhoods}
              onOptimizationComplete={setOptimizationResult}
              lastResult={optimizationResult}
              onGoToComparison={() => setPanel('compare')}
            />
          </div>
        )}

        {panel === 'compare' && (
          <div className="p-4 space-y-4">
            <h2 className="font-display font-semibold text-[24px] text-ink px-1">Compare Shipments</h2>
            {optimizationResult ? (
              <ComparisonDashboard result={optimizationResult} />
            ) : (
              <div className="card p-8 text-center">
                <p className="text-[13px] text-ink-faint">No result yet — run the optimizer first.</p>
                <button
                  onClick={() => setPanel('optimize')}
                  className="mt-4 px-5 py-2 rounded-full bg-[#14424E] text-white text-xs font-bold cursor-pointer"
                >
                  Go to Optimize
                </button>
              </div>
            )}
          </div>
        )}

        {panel === 'data' && (
          <div className="p-4 space-y-4">
            <h2 className="font-display font-semibold text-[24px] text-ink px-1">Demand Data ({neighborhoods.length})</h2>
            <FileUploader onDataLoaded={handleDataLoaded} onOpenSyntheticModal={() => setIsSyntheticModalOpen(true)} />
            <DataTable neighborhoods={neighborhoods} errors={validation.errors} onChange={setNeighborhoods} externalQuery="" />
            <ZoneLegendEditor
              neighborhoods={neighborhoods}
              zoneColors={zoneColors}
              onZoneColorChange={setZoneColor}
              onResetZoneColors={resetZoneColors}
              onApplyZones={handleApplyZones}
              compact
            />
          </div>
        )}

        {panel === 'lab' && (
          <div className="p-4 space-y-4">
            <h2 className="font-display font-semibold text-[24px] text-ink px-1">Scenario Lab</h2>
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
              onOptimizationComplete={setOptimizationResult}
              onGoToMap={() => setPanel('ask')}
            />
          </div>
        )}

        {panel === 'export' && (
          <div className="p-4 space-y-4">
            <h2 className="font-display font-semibold text-[24px] text-ink px-1">Export</h2>
            <ExportView neighborhoods={neighborhoods} result={optimizationResult} />
          </div>
        )}

        {panel === 'settings' && (
          <div className="p-4">
            <SettingsView
              theme={theme}
              onThemeChange={handleThemeChange}
              mapLayerOptions={mapLayerOptions}
              setMapLayerOptions={setMapLayerOptions}
              onResetZoneColors={resetZoneColors}
              onClearData={clearLocalData}
              apiBase={API_BASE}
            />
          </div>
        )}

        {panel === 'help' && (
          <div className="p-5 space-y-3">
            <h2 className="font-display font-semibold text-[24px] text-ink">Help Center</h2>
            {[
              { t: 'Ask anything', d: 'Type "optimize for 3 warehouses", "how much will I save?", or a place name. Suggestions and recents appear in Ask.' },
              { t: 'Search places', d: 'Use the map search bar — matching neighborhoods open as detail cards with Overview, Assignment and Nearby.' },
              { t: 'Save lists & runs', d: 'Saved → snapshot datasets as lists and optimization runs for later. Zones tab shows every category.' },
              { t: 'Map layers', d: 'Chips above the map toggle warehouses, routes, demand bubbles and service-radius circles.' }
            ].map((s) => (
              <div key={s.t} className="card p-4">
                <h3 className="font-bold text-sm text-ink">{s.t}</h3>
                <p className="text-[13px] text-ink-soft mt-1">{s.d}</p>
              </div>
            ))}
          </div>
        )}
        {/* Drag handle: resize panel (double-click resets) */}
        <div
          onPointerDown={startSidebarResize}
          onDoubleClick={resetSidebarWidth}
          title="Drag to resize panel • double-click to reset"
          className="absolute top-3 bottom-3 right-1 w-4 cursor-col-resize z-20 flex items-center justify-center touch-none select-none group"
        >
          <div className="w-[5px] h-16 rounded-full bg-[#E4E1D2] group-hover:bg-gold active:bg-gold transition-colors" />
        </div>
      </aside>

      {/* Map area */}
      <main className="flex-1 relative min-w-0 h-full">
        <div className="absolute inset-0">
          <MapView
            neighborhoods={neighborhoods}
            warehouses={optimizationResult?.warehouses ?? []}
            assignments={optimizationResult?.assignments ?? []}
            radiusKm={optimizationResult && optimizationResult.config.radius_enabled ? (optimizationResult.config.R_max_km ?? null) : null}
            fill
            minimal
            basemap={mapLayerOptions.basemap}
            onBasemapChange={(b) => setMapLayerOptions((prev) => ({ ...prev, basemap: b }))}
            colorBy={mapLayerOptions.colorBy}
            onColorByChange={(c) => setMapLayerOptions((prev) => ({ ...prev, colorBy: c }))}
            zoneColors={zoneColors}
            showWarehouses={layers.warehouses}
            showRoutes={layers.routes}
            showDemand={layers.demand}
            showRadius={layers.radius}
            focus={focus}
            routeColor={theme === 'dark' ? '#F0A0EA' : undefined}
            theme={theme}
            highlightId={highlightId}
          />
        </div>

        {/* Floating top bar: search + planning actions (starts right of the panel) */}
        <div
          className="absolute top-4 right-4 z-10 flex items-start gap-3"
          style={{ left: sidebarWidth + 32 }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch(searchText);
            }}
            className="flex items-center gap-2 bg-white rounded-full pl-5 pr-2 py-2 shadow-lg border border-black/5 w-[380px] max-w-[45%]"
          >
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search GridPoint maps"
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
            {searchText && (
              <button type="button" onClick={() => setSearchText('')} className="text-ink-faint hover:text-ink cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            )}
            <button type="submit" className="w-8 h-8 rounded-full bg-cream-deep flex items-center justify-center text-ink cursor-pointer">
              <Search className="w-4 h-4" />
            </button>
          </form>

          <div className="flex-1" />

          <div className="hidden lg:flex items-center gap-2 bg-white/95 rounded-full px-4 py-2 shadow-lg border border-black/5 text-[11px] font-semibold text-ink-soft whitespace-nowrap">
            Planning for {today} • {summary.count} nodes • K={kCount} • {summary.total_orders.toLocaleString()} orders
          </div>
          <button
            onClick={() => {
              if (window.confirm('Start a new planning run? This discards the current optimization result (data is kept).')) {
                setOptimizationResult(null);
                setHighlightId(null);
                setPanel('optimize');
              }
            }}
            className="hidden sm:flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white shadow-lg border border-black/5 text-[13px] font-bold text-ink hover:bg-cream-deep transition cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> New planning
          </button>
          <button
            onClick={() => {
              if (optimizationResult) {
                downloadFile('gridpoint_metrics_comparison.csv', buildMetricsCsv(optimizationResult));
                downloadFile('gridpoint_assignments.csv', buildAssignmentsCsv(optimizationResult));
              } else setPanel('export');
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-grape-300 shadow-lg text-[13px] font-bold text-ink hover:bg-grape-200 transition cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4" /> Export
          </button>
        </div>

        {/* Layer chips */}
        <div
          className="absolute top-[76px] z-10"
          style={{ left: sidebarWidth + 32 }}
        >
          <MapChips layers={layers} onToggle={toggleLayer} hasResult={!!optimizationResult} />
        </div>

        {/* Layers card (basemap + color-by + zones) */}
        <div className="absolute bottom-6 right-4 z-10">
          <button
            onClick={() => setPanel('settings')}
            title="Map themes & settings"
            className="px-4 py-2.5 rounded-2xl bg-white shadow-lg border border-black/5 text-[12px] font-bold text-ink hover:bg-cream-deep transition cursor-pointer"
          >
            ◈ Layers • {mapLayerOptions.basemap === 'osm' ? 'Standard' : mapLayerOptions.basemap === 'positron' ? 'Light' : 'Dark'} / {mapLayerOptions.colorBy}
          </button>
        </div>
      </main>

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
