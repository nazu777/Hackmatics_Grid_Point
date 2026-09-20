import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, X, Plus, Download } from 'lucide-react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { GmapsRail, type RailTab, isRailTab } from './components/GmapsRail';
import { LandingPage } from './components/LandingPage';
import { LoginPage, SignupPage } from './components/AuthPages';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AskPanel } from './components/AskPanel';
import { CensusModal } from './components/CensusModal';
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
  searchNeighborhoods,
  smartDefaults
} from './components/panelStore';
import { Neighborhood, ValidationResult, DatasetSummary, OptimizationConfig, OptimizationResult, MapLayerOptions, BasemapStyle } from './types';
import { validateData, localValidate, optimizeNetwork, exportCsv, fetchRouteGeometries } from './services/api';

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

/** Sidebar tab shell — fixed header, only the body scrolls. */
const SidePanel: React.FC<{ title: string; meta?: string; children: React.ReactNode }> = ({
  title,
  meta,
  children
}) => (
  <div className="flex flex-col h-full min-h-0">
    <div className="shrink-0 pl-5 pr-14 pt-5 pb-3">
      <h2 className="font-display font-semibold text-[24px] text-ink leading-tight">{title}</h2>
      {meta && <p className="text-[13px] text-ink-faint mt-0.5">{meta}</p>}
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto nice-scroll px-4 pb-4 space-y-4">{children}</div>
  </div>
);

const AppShell: React.FC = () => {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const urlTab: RailTab = isRailTab(tab) ? tab : 'ask';
  const [panel, setPanel] = useState<PanelMode>(urlTab);


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
  const [isCensusModalOpen, setIsCensusModalOpen] = useState(false);
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
  const [layers, setLayers] = useState<LayerFlags>({ warehouses: true, routes: true, demand: true, radius: true, traffic: false });

  // Route line rendering: straight displacement (default) or traced road paths
  const [linesMode, setLinesMode] = useState<'displacement' | 'roads'>('displacement');
  const [roadGeometries, setRoadGeometries] = useState<Record<string, number[][]>>({});
  const [tracing, setTracing] = useState(false);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);

  const traceRoutes = useCallback(async (ids: string[]) => {
    if (!optimizationResult || ids.length === 0) return;
    const whById = new Map(optimizationResult.warehouses.map((w) => [w.warehouse_id, w]));
    const nbById = new Map(neighborhoods.map((n) => [n.neighborhood_id, n]));
    const pairs: { id: string; from: { lat: number; lon: number }; to: { lat: number; lon: number } }[] = [];
    ids.forEach((id) => {
      const a = optimizationResult.assignments.find((x) => x.neighborhood_id === id);
      const nb = nbById.get(id);
      const wh = a ? whById.get(a.warehouse_id) : undefined;
      if (a && nb && wh) pairs.push({ id, from: { lat: nb.latitude, lon: nb.longitude }, to: { lat: wh.latitude, lon: wh.longitude } });
    });
    if (pairs.length === 0) return;
    setTracing(true);
    // Small chunks with progressive rendering: each chunk stays comfortably
    // inside serverless execution limits and traced roads appear incrementally.
    const CHUNK = 12;
    const seenProviders = new Set<string>();
    let stored = 0;
    try {
      for (let s = 0; s < pairs.length; s += CHUNK) {
        const slice = pairs.slice(s, s + CHUNK);
        setRouteNotice(`Tracing road paths… ${Math.min(s + slice.length, pairs.length)}/${pairs.length}`);
        const routes = await fetchRouteGeometries(
          slice.map((p) => ({ from: p.from, to: p.to })),
          !!optimizationResult.config.use_live_traffic
        );
        if (!Array.isArray(routes)) throw new Error('Route service returned an unexpected shape.');
        setRoadGeometries((prev) => {
          const next = { ...prev };
          routes.forEach((r, i) => {
            const line = r && Array.isArray(r.line) ? r.line : null;
            if (line && line.length >= 2 && slice[i]) {
              next[slice[i].id] = line;
              stored += 1;
            }
          });
          return next;
        });
        routes.forEach((r) => seenProviders.add(String(r?.provider ?? 'unknown').replace(' (cached)', '')));
      }
      const total = Object.keys(roadGeometries).length + stored;
      setRouteNotice(
        stored > 0
          ? `Road paths via ${[...seenProviders].join(' + ')} (${total}/${optimizationResult.assignments.length} traced)`
          : 'No road paths returned — showing displacement lines.'
      );
    } catch (e: any) {
      setRouteNotice(e instanceof Error ? e.message : 'Road tracing failed — showing displacement lines.');
    } finally {
      setTracing(false);
    }
  }, [optimizationResult, neighborhoods, roadGeometries]);

  const handleLinesMode = useCallback((mode: 'displacement' | 'roads') => {
    setLinesMode(mode);
    setRouteNotice(null);
    if (mode === 'roads' && optimizationResult) {
      const missing = optimizationResult.assignments
        .map((a) => a.neighborhood_id)
        .filter((id) => !roadGeometries[id]);
      if (missing.length === 0) {
        setRouteNotice(`All ${optimizationResult.assignments.length} road paths traced.`);
        return;
      }
      // Chunked + progressive: any dataset size traces incrementally.
      traceRoutes(missing);
    }
  }, [optimizationResult, roadGeometries, traceRoutes]);

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

  // Collapsible panel — hide to reveal the whole map (persisted)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('gridpoint_sidebar_collapsed') === '1';
    } catch { return false; }
  });
  const setCollapsedPersist = useCallback((v: boolean) => {
    setSidebarCollapsed(v);
    try {
      localStorage.setItem('gridpoint_sidebar_collapsed', v ? '1' : '0');
    } catch { /* ignore */ }
  }, []);

  const [optimizationConfig, setOptimizationConfig] = useState<OptimizationConfig>(() => {
    const saved = localStorage.getItem('gridpoint_opt_config');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    // Fresh setup: capacity, radius, live fuel + live traffic ON, with
    // capacity sized to the seeded demand so the first run is feasible.
    return { ...DEFAULT_CONFIG, ...smartDefaults(neighborhoods, DEFAULT_CONFIG.K) };
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
    setOptimizationConfig({ ...DEFAULT_CONFIG, ...smartDefaults(INITIAL_DATASET, DEFAULT_CONFIG.K) });
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

  // Traced road paths belong to a specific result/dataset — drop them on change
  useEffect(() => {
    setRoadGeometries({});
    setRouteNotice(null);
  }, [optimizationResult, neighborhoods]);

  // Service-radius overlay: enforced R_max from the result when present,
  // otherwise an adjustable preview (clearly labeled, not enforced).
  const [previewRadiusKm, setPreviewRadiusKm] = useState(10);
  const enforcedRadiusKm =
    optimizationResult && optimizationResult.config.radius_enabled
      ? (optimizationResult.config.R_max_km ?? null)
      : null;
  const usingPreviewRadius = layers.radius && enforcedRadiusKm == null && optimizationResult != null;
  const effectiveRadiusKm = enforcedRadiusKm ?? (layers.radius && optimizationResult ? previewRadiusKm : null);

  // Stable refs for the map — `?? []` inline would create a new array every
  // render and retrigger the map overlay effect (resetting the user's zoom).
  const mapWarehouses = useMemo(() => optimizationResult?.warehouses ?? [], [optimizationResult]);
  const mapAssignments = useMemo(() => optimizationResult?.assignments ?? [], [optimizationResult]);

  const railTab: RailTab =
    panel === 'results' || panel === 'detail' ? urlTab : (panel as RailTab);

  // Keep panel in sync with the URL — browser back/forward and deep links work.
  useEffect(() => {
    setPanel(urlTab);
  }, [urlTab]);

  /** Switch sidebar tabs via the URL (e.g. /app/optimize). */
  const goTab = useCallback((t: RailTab) => {
    navigate(`/app/${t}`);
  }, [navigate]);

  // Clicking the already-open tab toggles the panel; switching tabs reveals it.
  const handleRailTab = useCallback((t: RailTab) => {
    if (t === railTab) {
      setCollapsedPersist(!sidebarCollapsed);
    } else {
      navigate(`/app/${t}`);
      if (sidebarCollapsed) setCollapsedPersist(false);
    }
  }, [railTab, sidebarCollapsed, setCollapsedPersist, navigate]);

  const today = new Date().toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const kCount = optimizationResult?.warehouses.length ?? optimizationConfig.K;
  /** Back navigation from transient panels (detail/results) — tab targets go via URL. */
  const goBack = useCallback((back: PanelMode) => {
    if (back === 'results' || back === 'detail') setPanel(back);
    else navigate(`/app/${back}`);
  }, [navigate]);

  return (
    <div className="relative h-screen w-screen flex overflow-hidden bg-cream text-ink">
      <GmapsRail
        tab={railTab}
        onTab={handleRailTab}
        theme={theme}
        onThemeChange={handleThemeChange}
        userName={user?.name}
        onLogout={() => {
          logout();
          navigate('/', { replace: true });
        }}
      />

      {/* Floating panel — overlays the full-bleed map, never pushes it */}
      <aside
        style={{
          width: sidebarWidth,
          left: 76 + 16,
          top: 16,
          bottom: 16,
          display: sidebarCollapsed ? 'none' : undefined
        }}
        className="absolute z-20 bg-white border border-[#E4E1D2] rounded-3xl shadow-xl shadow-black/10 overflow-hidden"
      >
        {/* Close button — pinned top-right above all tab content */}
        <div className="absolute top-3 right-3 z-30 pointer-events-none">
          <button
            onClick={() => setCollapsedPersist(true)}
            title="Close side panel"
            aria-label="Close side panel"
            className="pointer-events-auto w-8 h-8 rounded-full bg-white border border-[#E4E1D2] shadow-lg flex items-center justify-center text-ink hover:bg-cream-deep transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {panel === 'ask' && (
          <AskPanel
            neighborhoods={neighborhoods}
            config={optimizationConfig}
            result={optimizationResult}
            onOptimize={runOptimize}
            onOpenCompare={() => goTab('compare')}
            onApplyZones={handleApplyZones}
            onExportDataset={handleExportDataset}
            onExportComparison={handleExportComparison}
            onOpenDetail={(n) => openDetail(n, 'ask')}
            onShowResults={(nodes, title) => {
              setResultNodes(nodes);
              setResultTitle(title);
              setPanel('results');
            }}
            onOpenCensus={() => setIsCensusModalOpen(true)}
          />
        )}

        {panel === 'results' && (
          <ResultRows
            nodes={resultNodes}
            title={resultTitle}
            onOpen={(n) => openDetail(n, 'results')}
            onClose={() => goTab('ask')}
          />
        )}

        {panel === 'detail' && detailNode && (
          <DetailCard
            node={detailNode}
            allNodes={neighborhoods}
            assignment={optimizationResult?.assignments.find((a) => a.neighborhood_id === detailNode.neighborhood_id) ?? null}
            demandRank={demandRank(detailNode)}
            onBack={() => goBack(detailBack)}
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
              goTab('ask');
            }}
            onLoadResult={(res) => {
              setOptimizationResult(res);
              goTab('compare');
            }}
          />
        )}

        {panel === 'optimize' && (
          <SidePanel title="Optimize" meta={`${neighborhoods.length} demand nodes loaded`}>
            <OptimizationPanel
              neighborhoods={neighborhoods}
              onOptimizationComplete={setOptimizationResult}
              lastResult={optimizationResult}
              onGoToComparison={() => goTab('compare')}
            />
          </SidePanel>
        )}

        {panel === 'compare' && (
          <SidePanel
            title="Compare Shipments"
            meta={
              optimizationResult?.comparison
                ? `K=${optimizationResult.warehouses.length} • ${optimizationResult.comparison.delta.pct_cost_saved}% saved`
                : undefined
            }
          >
            {optimizationResult ? (
              <ComparisonDashboard result={optimizationResult} neighborhoods={neighborhoods} zoneColors={zoneColors} onApply={setOptimizationResult} />
            ) : (
              <div className="card p-8 text-center">
                <p className="text-[13px] text-ink-faint">No result yet — run the optimizer first.</p>
                <button
                  onClick={() => goTab('optimize')}
                  className="mt-4 px-5 py-2 rounded-full bg-[#14424E] text-white text-xs font-bold cursor-pointer"
                >
                  Go to Optimize
                </button>
              </div>
            )}
          </SidePanel>
        )}

          <SidePanel
            title="Demand Data"
            meta={`${neighborhoods.length} nodes • ${summary.total_orders.toLocaleString()} daily orders`}
          >
            <FileUploader
              onDataLoaded={handleDataLoaded}
              onOpenSyntheticModal={() => setIsSyntheticModalOpen(true)}
              onOpenCensusModal={() => setIsCensusModalOpen(true)}
            />
            <DataTable neighborhoods={neighborhoods} errors={validation.errors} onChange={setNeighborhoods} externalQuery="" />
            <ZoneLegendEditor
              neighborhoods={neighborhoods}
              zoneColors={zoneColors}
              onZoneColorChange={setZoneColor}
              onResetZoneColors={resetZoneColors}
              onApplyZones={handleApplyZones}
              compact
            />
          </SidePanel>
        )}

        {panel === 'lab' && (
          <SidePanel title="Scenario Lab" meta="Trade-offs, demand shifts, fleet ETAs, diagnostics">
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
              onGoToMap={() => goTab('ask')}
            />
          </SidePanel>
        )}

        {panel === 'export' && (
          <SidePanel title="Export" meta="Datasets, comparisons and map snapshots">
            <ExportView neighborhoods={neighborhoods} result={optimizationResult} />
          </SidePanel>
        )}

        {panel === 'settings' && (
          <SidePanel title="Settings" meta="Appearance, map defaults, themes, data and support.">
            <SettingsView
              theme={theme}
              onThemeChange={handleThemeChange}
              mapLayerOptions={mapLayerOptions}
              setMapLayerOptions={setMapLayerOptions}
              onResetZoneColors={resetZoneColors}
              onClearData={clearLocalData}
              apiBase={API_BASE}
            />
          </SidePanel>
        )}

        {panel === 'help' && (
          <SidePanel title="Help Center">
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
          </SidePanel>
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
            warehouses={mapWarehouses}
            assignments={mapAssignments}
            radiusKm={effectiveRadiusKm}
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
            routeColor={theme === 'dark' && !layers.traffic ? '#F0A0EA' : undefined}
            colorRoutesByTraffic={layers.traffic}
            linesMode={linesMode}
            roadGeometries={roadGeometries}
            onRouteClick={(id) => traceRoutes([id])}
            theme={theme}
            highlightId={highlightId}
          />
        </div>

        {/* Floating top bar: search + planning actions (starts right of the panel) */}
        <div
          className="absolute top-4 right-4 z-10 flex items-start gap-3"
          style={{ left: sidebarCollapsed ? 16 : sidebarWidth + 32 }}
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
                goTab('optimize');
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
              } else goTab('export');
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-grape-300 shadow-lg text-[13px] font-bold text-[#10333D] hover:bg-grape-200 transition cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4" /> Export
          </button>
        </div>

        {/* Layer chips + displacement/roads toggle */}
        <div
          className="absolute top-[76px] z-10 flex flex-wrap items-center gap-2"
          style={{ left: sidebarCollapsed ? 16 : sidebarWidth + 32 }}
        >
          <MapChips layers={layers} onToggle={toggleLayer} hasResult={!!optimizationResult} />
          {optimizationResult && layers.routes && (
            <div className="flex items-center bg-white border border-white rounded-full p-1 text-[12px] shadow-sm">
              {(['displacement', 'roads'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => handleLinesMode(m)}
                  title={m === 'roads' ? 'Draw actual driving paths (fetched per route)' : 'Straight hub-spoke lines'}
                  className={`px-3 py-1.5 rounded-full font-semibold capitalize transition cursor-pointer ${
                    linesMode === m ? 'bg-[#14424E] text-white' : 'text-ink-faint hover:text-ink'
                  }`}
                >
                  {tracing && m === 'roads' ? 'Tracing…' : m}
                </button>
              ))}
            </div>
          )}
        </div>
        {routeNotice && (
          <div className="absolute top-[124px] z-10 text-[11px] font-semibold text-ink bg-white/95 rounded-full px-4 py-1.5 shadow border border-black/5"
            style={{ left: sidebarWidth + 32 }}>
            {routeNotice}
          </div>
        )}
        {usingPreviewRadius && (
          <div className="absolute top-[124px] z-10 flex items-center gap-2 text-[11px] font-semibold text-ink bg-white/95 rounded-full pl-4 pr-2 py-1.5 shadow border border-black/5"
            style={{ left: sidebarWidth + 32, marginTop: routeNotice ? 34 : 0 }}>
            <span>Preview circles ({previewRadiusKm} km) — not enforced</span>
            <button
              onClick={() => setPreviewRadiusKm((v) => Math.max(1, v - 5))}
              className="w-6 h-6 rounded-full bg-cream-deep hover:bg-gold-100 font-bold cursor-pointer"
            >
              −
            </button>
            <button
              onClick={() => setPreviewRadiusKm((v) => Math.min(200, v + 5))}
              className="w-6 h-6 rounded-full bg-cream-deep hover:bg-gold-100 font-bold cursor-pointer"
            >
              +
            </button>
            <button
              onClick={() => setPanel('optimize')}
              className="px-3 py-1 rounded-full bg-[#14424E] text-white font-bold hover:bg-pine-800 transition cursor-pointer"
            >
              Set R_max
            </button>
          </div>
        )}

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
        onOpenCensus={() => setIsCensusModalOpen(true)}
      />

      <CensusModal
        isOpen={isCensusModalOpen}
        onClose={() => setIsCensusModalOpen(false)}
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

/** Root redirect: logged-in users go straight to the app, others see the landing page. */
const RootRoute: React.FC = () => {
  const { user, token, loading } = useAuth();
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-cream text-ink">
        <p className="text-[13px] font-semibold text-ink-soft">Loading GridPoint…</p>
      </div>
    );
  }
  if (user && token) return <Navigate to="/app/ask" replace />;
  return <LandingPage />;
};

/** App router — URL reflects the active sidebar tab (/app/:tab). */
export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/app" element={<Navigate to="/app/ask" replace />} />
          <Route
            path="/app/:tab"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};
