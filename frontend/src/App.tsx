import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { Search, X, Plus, Download, GripVertical, MoveHorizontal } from 'lucide-react';
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
import { DataTab } from './components/DataTab';
import { ErrorDrawer } from './components/ErrorDrawer';
import { ScenariosPanel } from './components/ScenariosPanel';
import { OverviewTab } from './components/OverviewTab';
import { ExportView } from './components/ExportView';
import { SettingsView } from './components/SettingsView';
import { useZoneColors, getMapboxToken } from './components/mapThemes';
import type { ThemeMode } from './components/Topbar';
import {
  buildAssignmentsCsv,
  buildMetricsCsv,
  datasetCenter,
  downloadFile,
  getStoredVehicles,
  getStoredWarehouses,
  pushRecent,
  setStoredVehicles,
  setStoredWarehouses,
  setStoreUser,
  smartDefaults,
  getWorkspaceUpdatedAt,
  setWorkspaceUpdatedAt,
  WORKSPACE_CHANGED_EVENT
} from './components/panelStore';
import { SEARCH_CATEGORIES, searchAll, type SearchCategory } from './components/searchIndex';
import { SeedResultsPanel } from './components/SeedResultsPanel';
import { HYDERABAD_SAMPLE } from './data/sample';
import { Neighborhood, ValidationResult, DatasetSummary, OptimizationConfig, OptimizationResult, MapLayerOptions, BasemapStyle, OverviewAggregate, VehicleType, Warehouse, OrderMove, TrafficZone } from './types';
import { validateData, localValidate, optimizeNetwork, exportCsv, validateVehicles, validateWarehouses, localValidateVehicles, localValidateWarehouses, fetchRouteGeometries, fetchIsochrones, fetchCoverage as fetchCoverageGrid, fetchWarehouseFocus, fetchOverview, fetchTrafficZones, fetchUserWorkspace, saveUserWorkspace, isWorkspaceEmpty, type IsoFeature, type CoverageBounds, type CoverageCell, type WarehouseFocus } from './services/api';
import { WarehouseFocusCard } from './components/WarehouseFocusCard';

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
  simulation_mode: 'off',
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

  // Per-account storage: every account starts EMPTY — demand data, configs,
  // saved lists and zone colors are namespaced by user id so a fresh account
  // never sees another account's (or the old demo seed's) data.
  const ns = useCallback(
    (base: string) => (user && user.id ? `${base}_${user.id}` : base),
    [user]
  );
  const neighborhoodsKey = ns('gridpoint_neighborhoods');
  const optConfigKey = ns('gridpoint_opt_config');
  // Saved lists / recents live in a module store — scope it before children read it.
  setStoreUser(user?.id ?? null);

  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>(() => {
    const saved = localStorage.getItem(neighborhoodsKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) { /* ignore */ }
    }
    return [];
  });

  const [validation, setValidation] = useState<ValidationResult>(() => localValidate(neighborhoods));
  const [summary, setSummary] = useState<DatasetSummary>(() => computeSummary(neighborhoods));
  // Onboarding trio: owned fleet + existing sites live beside orders in the
  // Data tab (per-account store, synced server-side by the workspace effect).
  const [vehicles, setVehiclesState] = useState<VehicleType[]>(() => getStoredVehicles());
  const [warehouses, setWarehousesState] = useState<Warehouse[]>(() => getStoredWarehouses());
  const [vehiclesValidation, setVehiclesValidation] = useState<ValidationResult>(() => localValidateVehicles(getStoredVehicles()));
  const [warehousesValidation, setWarehousesValidation] = useState<ValidationResult>(() => localValidateWarehouses(getStoredWarehouses()));
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [isCensusModalOpen, setIsCensusModalOpen] = useState(false);
  const [isErrorDrawerOpen, setIsErrorDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try { return (localStorage.getItem('gridpoint-theme') as ThemeMode) || 'dark'; } catch { return 'dark'; }
  });
  const prevBasemap = useRef<BasemapStyle | null>(null);

  // Search / detail state (gmaps place flow)
  const [searchText, setSearchText] = useState('');
  // Phase J (#7): category dropdown across nodes/warehouses/vehicles/orders.
  const [searchCategory, setSearchCategory] = useState<SearchCategory>('all');
  const [resultNodes, setResultNodes] = useState<Neighborhood[]>([]);
  const [resultTitle, setResultTitle] = useState('');
  const [detailNode, setDetailNode] = useState<Neighborhood | null>(null);
  const [detailBack, setDetailBack] = useState<PanelMode>('ask');
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Phase G (#4): last seeding result (counts + entities browsable in-app).
  const [seedResult, setSeedResult] = useState<{
    source: string;
    nodes: Neighborhood[];
    vehicles: import('./types').VehicleType[];
    warehouses: import('./types').Warehouse[];
    at: number;
  } | null>(null);

  // Map layer chips (Phase B adds heatmap)
  const [layers, setLayers] = useState<LayerFlags>({ warehouses: true, routes: true, demand: true, radius: true, traffic: false, heatmap: true });
  // Phase B (#1): clicked warehouse zone isolation.
  const [focusedWarehouseId, setFocusedWarehouseId] = useState<string | null>(null);
  const [warehouseFocus, setWarehouseFocus] = useState<WarehouseFocus | null>(null);
  // Phase B (#2): city-wide continuous heatmap zones (server grid w/ local fallback).
  const [coverageCells, setCoverageCells] = useState<CoverageCell[]>([]);
  const [coverageRange, setCoverageRange] = useState<{ minKm: number; maxKm: number } | null>(null);
  const [coverageMeta, setCoverageMeta] = useState<{ grid_n?: number; bounds?: CoverageBounds; cell_step?: { dlat: number; dlon: number } } | null>(null);
  // Phase I (#6): live order moves from the last sim tick (map markers).
  const [liveMoves, setLiveMoves] = useState<OrderMove[]>([]);
  // Phase L (#9): dynamic zone-traffic polygons (centre-high → edge-low).
  const [trafficZones, setTrafficZones] = useState<TrafficZone[]>([]);

  // Route line rendering: straight displacement (default) or traced road paths
  const [linesMode, setLinesMode] = useState<'displacement' | 'roads'>('displacement');
  const [roadGeometries, setRoadGeometries] = useState<Record<string, number[][]>>({});
  // Live mirror so async tracing can reconcile traced/total without stale closures.
  const roadGeometriesRef = useRef<Record<string, number[][]>>({});
  useEffect(() => {
    roadGeometriesRef.current = roadGeometries;
  }, [roadGeometries]);
  const [tracing, setTracing] = useState(false);
  // Full re-optimization in flight (roads toggle switches distance metric).
  const [reopting, setReopting] = useState(false);
  // Last non-road metric, restored when leaving roads mode.
  const prevMetricRef = useRef<'haversine' | 'euclidean' | 'manhattan'>('haversine');
  // Road-network service-area polygons by warehouse_id (roads mode radius
  // heatmap). Missing/failed entries fall back to straight-line circles.
  const [isoGeometries, setIsoGeometries] = useState<Record<string, IsoFeature[]>>({});

  const traceRoutes = useCallback(async (ids: string[], resOverride?: OptimizationResult | null) => {
    const res = resOverride ?? optimizationResult;
    if (!res || ids.length === 0) return;
    const whById = new Map(res.warehouses.map((w) => [w.warehouse_id, w]));
    const nbById = new Map(neighborhoods.map((n) => [n.neighborhood_id, n]));
    const pairs: { id: string; from: { lat: number; lon: number }; to: { lat: number; lon: number } }[] = [];
    ids.forEach((id) => {
      const a = res.assignments.find((x) => x.neighborhood_id === id);
      const nb = nbById.get(id);
      const wh = a ? whById.get(a.warehouse_id) : undefined;
      if (a && nb && wh) pairs.push({ id, from: { lat: nb.latitude, lon: nb.longitude }, to: { lat: wh.latitude, lon: wh.longitude } });
    });
    if (pairs.length === 0) return;
    setTracing(true);
    // Small chunks with progressive rendering: each chunk stays comfortably
    // inside serverless execution limits and traced roads appear incrementally.
    const CHUNK = 12;
    try {
      for (let s = 0; s < pairs.length; s += CHUNK) {
        const slice = pairs.slice(s, s + CHUNK);
        const routes = await fetchRouteGeometries(
          slice.map((p) => ({ from: p.from, to: p.to })),
          !!res.config.use_live_traffic
        );
        if (!Array.isArray(routes)) throw new Error('Route service returned an unexpected shape.');
        // Count valid lines BEFORE setState (updaters must stay pure).
        const good: Record<string, number[][]> = {};
        routes.forEach((r, i) => {
          const line = r && Array.isArray(r.line) ? r.line : null;
          if (line && line.length >= 2 && slice[i]) good[slice[i].id] = line;
        });
        if (Object.keys(good).length > 0) {
          roadGeometriesRef.current = { ...roadGeometriesRef.current, ...good };
          setRoadGeometries(roadGeometriesRef.current);
        }
      }
      // Missing entries silently fall back to straight displacement lines.
    } catch {
      // Geometry failures are silent in the UI — the map falls back to
      // straight lines. Never surface raw validator strings (e.g. Pair #0…).
    } finally {
      setTracing(false);
    }
  }, [optimizationResult, neighborhoods]);

  /**
   * Road-network service-area polygons for each warehouse (roads-mode radius
   * heatmap). Travel-time contours from Mapbox Isochrone (driving profile):
   * R_max km at ~30 km/h urban speed → minutes, capped at the API's 60-min
   * limit. Two nested contours (half + full) give the heat gradient. Any
   * failure clears the layer so the map falls back to straight-line circles.
   */
  const fetchCoverage = useCallback(async (res: OptimizationResult, radiusKm: number | null) => {
    const token = getMapboxToken();
    if (!token || !radiusKm || radiusKm <= 0 || res.warehouses.length === 0) {
      setIsoGeometries({});
      return;
    }
    const full = Math.min(60, Math.max(5, Math.round(radiusKm * 2)));
    const contours = full >= 10 ? [Math.round(full / 2), full] : [full];
    try {
      const entries = await Promise.all(
        res.warehouses.map(async (w) => {
          const feats = await fetchIsochrones(w.longitude, w.latitude, contours, token);
          return [w.warehouse_id, feats] as const;
        })
      );
      setIsoGeometries(Object.fromEntries(entries));
    } catch {
      setIsoGeometries({});
    }
  }, []);

  const handleLinesMode = async (mode: 'displacement' | 'roads') => {
    if (mode === linesMode || !optimizationResult || neighborhoods.length === 0) {
      setLinesMode(mode);
      return;
    }
    if (reopting || tracing) return;
    if (mode === 'roads') {
      // Full re-optimization on the road network: assignments, distances,
      // radius feasibility and costs are all computed along real road routes
      // (backend: TomTom live / OSRM, straight-line fallback when offline).
      const cur = optimizationResult.config.distance_metric;
      if (cur !== 'road') {
        prevMetricRef.current = cur;
        const roadCfg = { ...optimizationResult.config, distance_metric: 'road' as const };
        setLinesMode(mode);
        setReopting(true);
        try {
          const res = await optimizeNetwork(neighborhoods, roadCfg);
          setOptimizationResult(res);
          handleConfigChange({ ...optimizationConfig, distance_metric: 'road' });
          const rKm = res.config.radius_enabled ? (res.config.R_max_km ?? null) : previewRadiusKm;
          await traceRoutes(res.assignments.map((a) => a.neighborhood_id), res);
          await fetchCoverage(res, rKm);
        } catch {
          setLinesMode('displacement');
          // Silent fallback to straight lines — raw validator strings
          // (e.g. Pair #0…) must never reach the map UI.
        } finally {
          setReopting(false);
        }
        return;
      }
      // Already road-based: just trace any missing driving paths.
      setLinesMode(mode);
      const missing = optimizationResult.assignments
        .map((a) => a.neighborhood_id)
        .filter((id) => !roadGeometries[id]);
      if (missing.length === 0) {
        const rKm = optimizationResult.config.radius_enabled ? (optimizationResult.config.R_max_km ?? null) : previewRadiusKm;
        await fetchCoverage(optimizationResult, rKm);
        return;
      }
      traceRoutes(missing);
      return;
    }
    // Back to displacement: restore the previous straight-line metric and
    // re-optimize so distances/radius match the displayed straight lines.
    setLinesMode(mode);
    setIsoGeometries({});
    if (optimizationResult.config.distance_metric === 'road') {
      const back = prevMetricRef.current;
      const dispCfg = { ...optimizationResult.config, distance_metric: back };
      setReopting(true);
      try {
        const res = await optimizeNetwork(neighborhoods, dispCfg);
        setOptimizationResult(res);
        handleConfigChange({ ...optimizationConfig, distance_metric: back });
      } catch {
        // Silent fallback — raw validator strings never reach the map UI.
      } finally {
        setReopting(false);
      }
    } else {
      // Back to displacement: straight lines render from the result as-is.
    }
  };

  // Resizable sidebar (drag the right edge; width persisted). Wide max so
  // the Data tab's orders/vehicles/warehouses tables fit without scrolling.
  const SIDEBAR_MIN = 280;
  const SIDEBAR_MAX = 1100;
  const SIDEBAR_DEFAULT = 400;
  const SIDEBAR_WIDE = 920;
  const clampSidebarWidth = (w: number) => {
    const max = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN + 40, window.innerWidth - 120));
    return Math.min(max, Math.max(SIDEBAR_MIN, w));
  };
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
      const w = clampSidebarWidth(startW + ev.clientX - startX);
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
    const saved = localStorage.getItem(optConfigKey);
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

  const { zoneColors, resetZoneColors } = useZoneColors(ns('gridpoint_zone_colors'));

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
    localStorage.setItem(optConfigKey, JSON.stringify(updated));
  };

  // Owned warehouses ride in the optimizer config: every optimize path
  // (Ask, Scenario lab, roads re-opt via echoed config) anchors placement
  // to owned sites, compares against the current network, and assigns the
  // fleet — with no per-panel plumbing.
  useEffect(() => {
    setOptimizationConfig((prev) => {
      const cur = prev.owned_warehouses ?? [];
      if (prev.respect_owned === true && cur.length === warehouses.length &&
          cur.every((w, i) => w === warehouses[i])) return prev;
      const next = { ...prev, owned_warehouses: warehouses, respect_owned: true };
      try { localStorage.setItem(optConfigKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [warehouses, optConfigKey]);

  // Phase F: Overview aggregate (refreshed on demand + when the panel opens)
  const [overview, setOverview] = useState<OverviewAggregate | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const refreshOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const ov = await fetchOverview(
        neighborhoods,
        optimizationResult?.warehouses ?? [],
        optimizationResult?.assignments ?? [],
        optimizationConfig
      );
      setOverview(ov);
    } finally {
      setOverviewLoading(false);
    }
  }, [neighborhoods, optimizationResult, optimizationConfig]);
  useEffect(() => {
    if (panel === 'overview') refreshOverview();
  }, [panel, refreshOverview]);

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
    localStorage.setItem(neighborhoodsKey, JSON.stringify(data));
    const res = await validateData(data);
    setValidation(res);
  }, [neighborhoodsKey]);

  useEffect(() => {
    triggerValidation(neighborhoods);
  }, [neighborhoods, triggerValidation]);

  // Fleet + sites: validate (server with offline fallback) and persist to the
  // per-account store on every change (store writes also notify the server
  // workspace sync). Fleet mirrors into the optimizer config.
  const setVehicles = useCallback((rows: VehicleType[]) => {
    setVehiclesState(rows);
    setStoredVehicles(rows);
    validateVehicles(rows).then(setVehiclesValidation);
  }, []);
  const setWarehouses = useCallback((rows: Warehouse[]) => {
    setWarehousesState(rows);
    setStoredWarehouses(rows);
    validateWarehouses(rows).then(setWarehousesValidation);
  }, []);
  useEffect(() => {
    validateVehicles(vehicles).then(setVehiclesValidation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    validateWarehouses(warehouses).then(setWarehousesValidation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setOptimizationConfig((prev) => {
      const cur = prev.vehicle_fleet ?? [];
      if (cur.length === vehicles.length && cur.every((v, i) => v === vehicles[i])) return prev;
      const next = { ...prev, vehicle_fleet: vehicles };
      try { localStorage.setItem(optConfigKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [vehicles, optConfigKey]);

  // ---- Server-side workspace sync (warehouses, vehicles, demand, config) ----
  // Pull on login (last-write-wins by updated_at; empty side yields), push
  // debounced on every local change. LocalStorage stays as offline cache.
  const pullingRef = useRef(false);
  const [wsBump, setWsBump] = useState(0);
  useEffect(() => {
    const onChange = () => setWsBump((v) => v + 1);
    window.addEventListener(WORKSPACE_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    pullingRef.current = true;
    fetchUserWorkspace().then((server) => {
      if (cancelled) return;
      const finish = () => { pullingRef.current = false; };
      if (!server) return finish();
      const localTs = getWorkspaceUpdatedAt();
      const local = {
        neighborhoods,
        vehicles: getStoredVehicles(),
        warehouses: getStoredWarehouses(),
        config: optimizationConfig as OptimizationConfig
      };
      const localEmpty = isWorkspaceEmpty({ ...local, updated_at: localTs });
      const serverEmpty = isWorkspaceEmpty(server);
      if (serverEmpty && !localEmpty) {
        // Fresh server copy: push this device's data up.
        saveUserWorkspace({ ...local, updated_at: localTs || Date.now() / 1000 }).then((saved) => {
          if (!cancelled && saved) setWorkspaceUpdatedAt(saved.updated_at);
          finish();
        });
        return;
      }
      if (!serverEmpty && (localEmpty || server.updated_at > localTs)) {
        // Adopt server (newer, or local empty): write offline cache + state.
        try {
          localStorage.setItem(neighborhoodsKey, JSON.stringify(server.neighborhoods));
          localStorage.setItem(optConfigKey, JSON.stringify(server.config ?? optimizationConfig));
        } catch { /* ignore */ }
        setStoredVehicles(server.vehicles);
        setStoredWarehouses(server.warehouses);
        setWorkspaceUpdatedAt(server.updated_at);
        setNeighborhoods(server.neighborhoods);
        // Data-tab trio state follows the adopted server copy.
        setVehiclesState(server.vehicles);
        setWarehousesState(server.warehouses);
        validateVehicles(server.vehicles).then(setVehiclesValidation);
        validateWarehouses(server.warehouses).then(setWarehousesValidation);
        triggerValidation(server.neighborhoods);
        if (server.config) setOptimizationConfig(server.config);
        finish();
        return;
      }
      if (!localEmpty && localTs > server.updated_at) {
        // This device is newer: push local up.
        saveUserWorkspace({ ...local, updated_at: localTs }).then((saved) => {
          if (!cancelled && saved) setWorkspaceUpdatedAt(saved.updated_at);
          finish();
        });
        return;
      }
      finish();
    });
    return () => { cancelled = true; };
    // Pull once per login; push effect below handles ongoing changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user || pullingRef.current) return;
    const t = setTimeout(() => {
      if (!user || pullingRef.current) return;
      const localTs = getWorkspaceUpdatedAt();
      const payload = {
        neighborhoods,
        vehicles: getStoredVehicles(),
        warehouses: getStoredWarehouses(),
        config: optimizationConfig as OptimizationConfig,
        updated_at: localTs || Date.now() / 1000
      };
      if (isWorkspaceEmpty({ ...payload }) && !localTs) return; // fresh account, nothing to save
      saveUserWorkspace(payload).then((saved) => {
        if (saved) setWorkspaceUpdatedAt(saved.updated_at);
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [neighborhoods, optimizationConfig, user, wsBump]);

  const handleDataLoaded = (newNodes: Neighborhood[], valResult: ValidationResult, newSummary: DatasetSummary) => {
    setNeighborhoods(newNodes);
    setValidation(valResult);
    setSummary(newSummary);
    localStorage.setItem(neighborhoodsKey, JSON.stringify(newNodes));
  };

  const handleLoadSample = () => {
    setNeighborhoods(HYDERABAD_SAMPLE);
    triggerValidation(HYDERABAD_SAMPLE);
  };

  const handleSyntheticGenerated = (newNodes: Neighborhood[]) => {
    setNeighborhoods(newNodes);
    triggerValidation(newNodes);
    // Phase G: seeding shows what it created (nodes/orders browsable).
    setSeedResult({ source: 'Synthetic city', nodes: newNodes, vehicles: [], warehouses: [], at: Date.now() });
  };

  const handleVehiclesLoaded = (rows: VehicleType[], valResult: ValidationResult) => {
    setVehiclesState(rows);
    setStoredVehicles(rows);
    setVehiclesValidation(valResult);
    // Phase G: fleet seeding shows what it created.
    setSeedResult((s) => ({
      source: 'Synthetic fleet',
      nodes: s?.nodes ?? neighborhoods,
      vehicles: rows,
      warehouses: s?.warehouses ?? [],
      at: Date.now()
    }));
  };

  const handleWarehousesLoaded = (rows: Warehouse[], valResult: ValidationResult) => {
    setWarehousesState(rows);
    setStoredWarehouses(rows);
    setWarehousesValidation(valResult);
    // Phase G: site seeding shows what it created.
    setSeedResult((s) => ({
      source: 'Synthetic sites',
      nodes: s?.nodes ?? neighborhoods,
      vehicles: s?.vehicles ?? [],
      warehouses: rows,
      at: Date.now()
    }));
  };

  const handleApplyZones = (updated: Neighborhood[]) => {
    setNeighborhoods(updated);
    triggerValidation(updated);
  };

  const clearLocalData = () => {
    if (!window.confirm('Reset all saved app data (demand, config, themes)?')) return;
    [neighborhoodsKey, optConfigKey, ns('gridpoint_zone_colors')].forEach((k) => {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
    setNeighborhoods([]);
    setVehicles([]);
    setWarehouses([]);
    setOptimizationConfig(DEFAULT_CONFIG);
    setOptimizationResult(null);
    resetZoneColors();
  };

  // ---- Ask actions ----
  const runOptimize = useCallback(async (k: number): Promise<OptimizationResult | null> => {
    try {
      // Owned warehouses ride along: placement anchors to them, the baseline
      // compares against the current network, and the fleet gets assigned.
      const cfg = {
        ...optimizationConfig,
        K: k,
        owned_warehouses: warehouses,
        respect_owned: true
      };
      const res = await optimizeNetwork(neighborhoods, cfg);
      setOptimizationResult(res);
      setHighlightId(null);
      return res;
    } catch {
      return null;
    }
  }, [neighborhoods, optimizationConfig, warehouses]);

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
    // Phase J acceptance: empty query shows a hint, never a dead state.
    if (!query) {
      setResultNodes([]);
      setResultTitle('Type to search nodes, warehouses, trucks & cars, or orders — pick a category first.');
      setPanel('results');
      return;
    }
    pushRecent(query);
    // Corpus: nodes + warehouses (result + workspace sites) + fleet vehicles.
    const whById = new Map<string, import('./types').Warehouse>();
    [...(optimizationResult?.warehouses ?? []), ...warehouses].forEach((w) => {
      if (!whById.has(w.warehouse_id)) whById.set(w.warehouse_id, w);
    });
    const hits = searchAll(
      { nodes: neighborhoods, warehouses: [...whById.values()], vehicles },
      query,
      searchCategory
    );
    if (hits.length === 0) {
      setResultNodes([]);
      setResultTitle(`No matches for “${query}” in ${SEARCH_CATEGORIES.find((c) => c.id === searchCategory)?.label ?? 'All'} — try another category.`);
      setPanel('results');
      return;
    }
    // Single node/order hit → open detail; warehouse/vehicle hits → focus/map.
    if (hits.length === 1) {
      const h = hits[0];
      if (h.kind === 'warehouse') {
        handleWarehouseClick(h.refId);
        const w = whById.get(h.refId);
        if (w) setFocus({ lat: w.latitude, lon: w.longitude, zoom: 13, key: Date.now() });
        return;
      }
      if (h.kind === 'vehicle') {
        setResultTitle(`Vehicle ${h.id} — open the fleet table to edit`);
        setResultNodes([]);
        setPanel('results');
        goTab('data');
        return;
      }
      const node = neighborhoods.find((n) => n.neighborhood_id === h.refId);
      if (node) {
        openDetail(node, 'ask');
        return;
      }
    }
    // Multi-hit: nodes/orders open as tappable rows; warehouses/vehicles list too.
    const nodeIds = new Set(
      hits.filter((h) => h.kind === 'node' || h.kind === 'order').map((h) => h.refId)
    );
    const nodes = neighborhoods.filter((n) => nodeIds.has(n.neighborhood_id)).slice(0, 30);
    if (nodes.length > 0) {
      setResultNodes(nodes);
      setResultTitle(`${hits.length} matches for “${query}” (${searchCategory})`);
      setPanel('results');
      return;
    }
    // Warehouse/vehicle-only hits: surface as rows via the first matching node
    // set when possible, else a hint row state.
    const whHit = hits.find((h) => h.kind === 'warehouse');
    if (whHit) {
      handleWarehouseClick(whHit.refId);
      const w = whById.get(whHit.refId);
      if (w) setFocus({ lat: w.latitude, lon: w.longitude, zoom: 13, key: Date.now() });
      return;
    }
    setResultNodes([]);
    setResultTitle(
      hits.map((h) => `${h.label} — ${h.sub}`).slice(0, 8).join('\n') || `No matches for “${query}”.`
    );
    setPanel('results');
  };

  const demandRank = (node: Neighborhood): number | null => {
    const sorted = [...neighborhoods].sort((a, b) => Number(b.daily_orders) - Number(a.daily_orders));
    const i = sorted.findIndex((n) => n.neighborhood_id === node.neighborhood_id);
    return i >= 0 ? i + 1 : null;
  };

  const toggleLayer = (key: keyof LayerFlags) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  // Traced road paths + coverage polygons belong to a specific result/dataset — drop them on change.
  // A fresh non-road result also drops the roads toggle back to displacement.
  // Phase B: warehouse focus belongs to a result too — clear it here.
  // Phase I: live moves belong to a tick on a specific assignment — clear too.
  useEffect(() => {
    setRoadGeometries({});
    roadGeometriesRef.current = {};
    setIsoGeometries({});
    setFocusedWarehouseId(null);
    setWarehouseFocus(null);
    setLiveMoves([]);
    if (optimizationResult && optimizationResult.config.distance_metric !== 'road') {
      setLinesMode('displacement');
    }
  }, [optimizationResult, neighborhoods]);

  // Phase L (#9): zone polygons follow the demand (tick 0 baseline; the live
  // tick intensities ride along in SimulationLive + corridor factors).
  useEffect(() => {
    if (neighborhoods.length === 0) {
      setTrafficZones([]);
      return;
    }
    let cancelled = false;
    fetchTrafficZones(neighborhoods, 0).then((r) => {
      if (!cancelled) setTrafficZones(r.zones || []);
    });
    return () => {
      cancelled = true;
    };
  }, [neighborhoods]);

  // Phase B (#2): city-wide continuous heatmap grid — server cells with local
  // fallback, recomputed from the ACTIVE assignment distances whenever they change.
  useEffect(() => {
    if (!optimizationResult || !layers.heatmap || neighborhoods.length === 0) {
      setCoverageCells([]);
      setCoverageRange(null);
      setCoverageMeta(null);
      return;
    }
    let cancelled = false;
    const dists = optimizationResult.assignments.map((a) => Number(a.distance_km) || 0);
    const range = dists.length
      ? { minKm: Math.round(Math.min(...dists) * 100) / 100, maxKm: Math.round(Math.max(...dists) * 100) / 100 }
      : null;
    setCoverageRange(range);
    fetchCoverageGrid(neighborhoods, optimizationResult.assignments, 24).then((grid) => {
      if (!cancelled && grid && Array.isArray(grid.cells)) {
        setCoverageCells(grid.cells);
        if (typeof grid.min_km === 'number' && typeof grid.max_km === 'number') {
          setCoverageRange({ minKm: grid.min_km, maxKm: grid.max_km });
        }
        setCoverageMeta({ grid_n: grid.grid_n, bounds: grid.bounds, cell_step: grid.cell_step });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [optimizationResult, neighborhoods, layers.heatmap]);

  // Phase B (#1): resolve the isolated zone payload (server w/ local fallback).
  useEffect(() => {
    if (!focusedWarehouseId || !optimizationResult) {
      setWarehouseFocus(null);
      return;
    }
    let cancelled = false;
    fetchWarehouseFocus(
      focusedWarehouseId,
      neighborhoods,
      optimizationResult.warehouses,
      optimizationResult.assignments
    ).then((f) => {
      if (!cancelled) setWarehouseFocus(f);
    });
    return () => {
      cancelled = true;
    };
  }, [focusedWarehouseId, optimizationResult, neighborhoods]);

  /** Phase K (#8): selecting a warehouse auto-enables + isolates its radius;
   * deselect restores the previous layer flag (manual toggle still untouched). */
  const prevRadiusRef = useRef<boolean | null>(null);
  const handleWarehouseClick = useCallback((warehouseId: string) => {
    setFocusedWarehouseId((prev) => {
      if (prev === warehouseId) {
        // Deselect (click again): restore the saved layer flag.
        if (prevRadiusRef.current != null) {
          const back = prevRadiusRef.current;
          prevRadiusRef.current = null;
          setLayers((l) => ({ ...l, radius: back }));
        }
        return null;
      }
      // New select: remember the flag once, then force radius on.
      if (prev == null) {
        prevRadiusRef.current = layers.radius;
        setLayers((l) => (l.radius ? l : { ...l, radius: true }));
      }
      return warehouseId;
    });
    setHighlightId(null);
  }, [layers.radius]);

  // Phase K: Esc also clears the warehouse focus (restores the layer flag).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setFocusedWarehouseId((prev) => {
        if (prev == null) return prev;
        if (prevRadiusRef.current != null) {
          const back = prevRadiusRef.current;
          prevRadiusRef.current = null;
          setLayers((l) => ({ ...l, radius: back }));
        }
        return null;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  /** Open the Data tab on a specific sub-tab (orders/vehicles/warehouses). */
  const openDataSubtab = useCallback((t: 'orders' | 'vehicles' | 'warehouses') => {
    try { localStorage.setItem('gridpoint_data_subtab', t); } catch { /* ignore */ }
    goTab('data');
  }, [goTab]);

  // Clicking the already-open tab toggles the panel; switching tabs reveals it.
  const handleRailTab = useCallback((t: RailTab) => {
    if (t === railTab) {
      setCollapsedPersist(!sidebarCollapsed);
    } else {
      navigate(`/app/${t}`);
      if (sidebarCollapsed) setCollapsedPersist(false);
    }
  }, [railTab, sidebarCollapsed, setCollapsedPersist, navigate]);

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
        className="absolute z-20 bg-white border border-[#E4E1D2] rounded-3xl shadow-xl shadow-black/10 overflow-hidden pr-5"
      >
        {/* Close + width buttons — pinned top-right above all tab content */}
        <div className="absolute top-3 right-3 z-30 pointer-events-none flex items-center gap-1.5">
          <button
            onClick={() => {
              const target = sidebarWidthRef.current >= SIDEBAR_WIDE - 20 ? SIDEBAR_DEFAULT : SIDEBAR_WIDE;
              const w = clampSidebarWidth(target);
              sidebarWidthRef.current = w;
              setSidebarWidth(w);
              try {
                localStorage.setItem('gridpoint_sidebar_width', String(Math.round(w)));
              } catch { /* ignore */ }
            }}
            title={sidebarWidth >= SIDEBAR_WIDE - 20 ? 'Narrow panel' : 'Widen panel for tables'}
            aria-label="Toggle panel width"
            className="pointer-events-auto h-8 px-2.5 rounded-full bg-white border border-[#E4E1D2] shadow-lg flex items-center justify-center gap-1 text-ink hover:bg-cream-deep transition cursor-pointer text-[11px] font-bold"
          >
            <MoveHorizontal className="w-4 h-4" />
            <span>{sidebarWidth >= SIDEBAR_WIDE - 20 ? 'Narrow' : 'Wide'}</span>
          </button>
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
            vehicles={vehicles}
            warehouses={warehouses}
            config={optimizationConfig}
            result={optimizationResult}
            validation={validation}
            vehiclesValidation={vehiclesValidation}
            warehousesValidation={warehousesValidation}
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
            onOpenDataTab={openDataSubtab}
            onOpenOverview={() => goTab('overview')}
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
            onOpenWarehouse={(wid) => {
              handleWarehouseClick(wid);
              const w = optimizationResult?.warehouses.find((x) => x.warehouse_id === wid);
              if (w) setFocus({ lat: w.latitude, lon: w.longitude, zoom: 13, key: Date.now() });
            }}
            onOpenVehicle={() => goTab('data')}
            onOpenNode={(n) => openDetail(n, 'saved')}
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
              ownedWarehouses={warehouses}
              fleet={vehicles}
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

        {panel === 'data' && (
          <SidePanel
            title="Data"
            meta={`${neighborhoods.length} orders • ${vehicles.length} vehicles • ${warehouses.length} warehouses`}
          >
            {/* Phase G (#4): seeding results — counts + browsable entities. */}
            {seedResult && (
              <SeedResultsPanel
                seed={seedResult}
                onLoadNodes={(nodes) => {
                  setNeighborhoods(nodes);
                  triggerValidation(nodes);
                }}
                onLoadVehicles={(fleet) => {
                  setVehicles(fleet);
                  setSeedResult((s) => (s ? { ...s, vehicles: fleet } : s));
                }}
                onLoadWarehouses={(sites) => {
                  setWarehouses(sites);
                  setSeedResult((s) => (s ? { ...s, warehouses: sites } : s));
                }}
                onViewOnMap={(nodes) => {
                  if (nodes.length > 0) {
                    setFocus({ lat: nodes[0].latitude, lon: nodes[0].longitude, zoom: 11, key: Date.now() });
                    setHighlightId(nodes[0].neighborhood_id);
                  }
                }}
                onOpenNode={(n) => openDetail(n, 'data')}
              />
            )}
            <DataTab
              neighborhoods={neighborhoods}
              vehicles={vehicles}
              warehouses={warehouses}
              ordersValidation={validation}
              vehiclesValidation={vehiclesValidation}
              warehousesValidation={warehousesValidation}
              summary={summary}
              center={datasetCenter(neighborhoods)}
              onOrdersChange={(updated) => {
                setNeighborhoods(updated);
                triggerValidation(updated);
              }}
              onVehiclesChange={setVehicles}
              onWarehousesChange={setWarehouses}
              onOrdersLoaded={handleDataLoaded}
              onVehiclesLoaded={handleVehiclesLoaded}
              onWarehousesLoaded={handleWarehousesLoaded}
              onOpenCensus={() => setIsCensusModalOpen(true)}
              onLoadSample={handleLoadSample}
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
                localStorage.setItem(neighborhoodsKey, JSON.stringify(updated));
                setSummary(computeSummary(updated));
              }}
              onUpdateConfig={handleConfigChange}
              onOptimizationComplete={setOptimizationResult}
              onGoToMap={() => goTab('ask')}
              onOpenWarehouse={(wid) => handleWarehouseClick(wid)}
              onLiveMoves={(moves) => setLiveMoves(moves)}
            />
          </SidePanel>
        )}

        {panel === 'overview' && (
          <SidePanel
            title="Overview"
            meta={
              overview
                ? `${overview.warehouse_count} warehouses • ${overview.order_totals.daily_orders.toLocaleString()} orders • $${overview.distance_cost.total_cost.toLocaleString()}`
                : 'Network rollup'
            }
          >
            <OverviewTab
              overview={overview}
              loading={overviewLoading}
              result={optimizationResult}
              nodeCount={neighborhoods.length}
              onRefresh={refreshOverview}
              onGoTo={goTab}
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
              { t: 'Map layers', d: 'Chips above the map toggle warehouses, routes, traffic, heatmap, demand bubbles and service-radius circles. Click a warehouse pin to isolate its zone.' }
            ].map((s) => (
              <div key={s.t} className="card p-4">
                <h3 className="font-bold text-sm text-ink">{s.t}</h3>
                <p className="text-[13px] text-ink-soft mt-1">{s.d}</p>
              </div>
            ))}
          </SidePanel>
        )}
        {/* Resize grip: proper 6-dot handle docked inside the panel's
            right gutter (drags 280–1100px, double-click resets). The aside
            reserves pr-5 so panel content never slides under it. */}
        <div
          onPointerDown={startSidebarResize}
          onDoubleClick={resetSidebarWidth}
          title="Drag to resize panel • double-click to reset"
          className="absolute top-0 bottom-0 right-0 w-5 cursor-col-resize z-20 flex items-center justify-center touch-none select-none group"
        >
          <GripVertical className="w-4 h-6 text-ink-faint group-hover:text-ink transition-colors" />
        </div>
      </aside>

      {/* Map area */}
      <main className="flex-1 relative min-w-0 h-full">
        <div className="absolute inset-0">
          <MapView
            neighborhoods={neighborhoods}
            warehouses={mapWarehouses}
            ownedWarehouses={warehouses}
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
            isochrones={isoGeometries}
            onRouteClick={(id) => traceRoutes([id])}
            onWarehouseClick={handleWarehouseClick}
            focusedWarehouseId={focusedWarehouseId}
            coverageCells={coverageCells}
            coverageMeta={coverageMeta}
            showHeatmap={layers.heatmap}
            coverageRange={coverageRange}
            liveMoves={liveMoves}
            showLive={liveMoves.length > 0}
            trafficZones={trafficZones}
            showZones={layers.traffic}
            theme={theme}
            highlightId={highlightId}
          />
        </div>

        {/* Phase B (#1): isolated warehouse zone card + (#2/#5) layer legends live in MapView. */}
        {warehouseFocus && warehouseFocus.found && (
          <WarehouseFocusCard
            focus={warehouseFocus}
            onClear={() => setFocusedWarehouseId(null)}
            onCenter={(lat, lon) => setFocus({ lat, lon, zoom: 13, key: Date.now() })}
            onOpenNode={(nid) => {
              const node = neighborhoods.find((n) => n.neighborhood_id === nid);
              if (node) openDetail(node, 'ask');
            }}
          />
        )}

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
            className="flex items-center gap-2 bg-white rounded-full pl-2 pr-2 py-2 shadow-lg border border-black/5 w-[440px] max-w-[55%]"
          >
            {/* Phase J (#7): category dropdown — nodes, warehouses, trucks/cars, orders. */}
            <select
              value={searchCategory}
              onChange={(e) => setSearchCategory(e.target.value as SearchCategory)}
              title="Search category"
              className="bg-cream-deep border border-black/5 rounded-full text-[12px] font-bold text-ink px-2.5 py-1.5 focus:outline-none cursor-pointer shrink-0"
            >
              {SEARCH_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search nodes, warehouses, trucks, orders…"
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none min-w-0"
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
                  disabled={reopting || tracing}
                  title={m === 'roads' ? 'Re-optimize on the road network: distances, assignments and radius all computed along real driving routes' : 'Straight hub-spoke lines with straight-line distances'}
                  className={`px-3 py-1.5 rounded-full font-semibold capitalize transition cursor-pointer disabled:opacity-60 ${
                    linesMode === m ? 'bg-[#14424E] text-white' : 'text-ink-faint hover:text-ink'
                  }`}
                >
                  {reopting && m === linesMode ? 'Optimizing…' : tracing && m === 'roads' ? 'Tracing…' : m}
                </button>
              ))}
            </div>
          )}
        </div>
        {usingPreviewRadius && (
          <div className="absolute top-[124px] z-10 flex items-center gap-2 text-[11px] font-semibold text-ink bg-white/95 rounded-full pl-4 pr-2 py-1.5 shadow border border-black/5"
            style={{ left: sidebarWidth + 32 }}>
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
              onClick={() => goTab('optimize')}
              className="px-3 py-1 rounded-full bg-[#14424E] text-white font-bold hover:bg-pine-800 transition cursor-pointer"
            >
              Set R_max
            </button>
          </div>
        )}
      </main>

      <CensusModal
        isOpen={isCensusModalOpen}
        onClose={() => setIsCensusModalOpen(false)}
        onGenerated={(nodes) => {
          handleSyntheticGenerated(nodes);
          setSeedResult({ source: 'Census real demand', nodes, vehicles: [], warehouses: [], at: Date.now() });
        }}
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
