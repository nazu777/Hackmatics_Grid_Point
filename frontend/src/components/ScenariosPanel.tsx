import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  TrendingUp,
  Truck,
  AlertTriangle,
  Zap,
  Clock,
  Fuel,
  RefreshCw,
  CheckCircle2,
  Sparkles,
  Layers,
  ArrowRight,
  Activity,
  Satellite
} from 'lucide-react';
import {
  Neighborhood,
  OptimizationConfig,
  OptimizationResult,
  TradeoffResult,
  FleetETAResult,
  ConstraintDiagnostics,
  LiveSnapshot,
  SpilloverEvent,
  ActiveSpill
} from '../types';
import {
  getTradeoffCurve,
  applyDemandShift,
  getFleetETA,
  getConstraintDiagnostics,
  optimizeNetwork,
  runSimulationTick,
  fetchLiveSnapshot
} from '../services/api';

interface ScenariosPanelProps {
  neighborhoods: Neighborhood[];
  config: OptimizationConfig;
  lastResult: OptimizationResult | null;
  onUpdateNeighborhoods: (updated: Neighborhood[]) => void;
  onUpdateConfig: (config: OptimizationConfig) => void;
  onOptimizationComplete: (result: OptimizationResult) => void;
  onGoToMap: () => void;
}

export const ScenariosPanel: React.FC<ScenariosPanelProps> = ({
  neighborhoods,
  config,
  lastResult,
  onUpdateNeighborhoods,
  onUpdateConfig,
  onOptimizationComplete,
  onGoToMap
}) => {
  // Scenario 1: Tradeoff State
  const [infraCost, setInfraCost] = useState<number>(config.infra_cost_per_warehouse || 500);
  const [maxKEval, setMaxKEval] = useState<number>(5);
  const [tradeoffResult, setTradeoffResult] = useState<TradeoffResult | null>(null);
  const [isTradeoffLoading, setIsTradeoffLoading] = useState<boolean>(false);

  // Scenario 2: Demand Shift State
  const [demandShiftPct, setDemandShiftPct] = useState<number>(25);
  const [isShiftApplying, setIsShiftApplying] = useState<boolean>(false);

  // Scenario 3: Fleet & ETA State
  const [trafficPct, setTrafficPct] = useState<number>(Math.round((config.traffic_factor || 0) * 100));
  const [selectedVehicle, setSelectedVehicle] = useState<'bike' | 'van' | 'truck'>('van');
  const [fuelCost, setFuelCost] = useState<number>(config.fuel_cost_per_km || 0.2);
  const [liveFuel, setLiveFuel] = useState<boolean>(!!config.use_live_fuel);
  const [fuelCity, setFuelCity] = useState<string>(config.fuel_city || 'Bengaluru');
  const [fleetETA, setFleetETA] = useState<FleetETAResult | null>(null);

  // Scenario 4: Diagnostics State
  const [diagnostics, setDiagnostics] = useState<ConstraintDiagnostics | null>(null);

  // Phase F: Realtime automation state (simulation_mode + poll tick + spillover log)
  const [simMode, setSimMode] = useState<'off' | 'realtime'>(config.simulation_mode || 'off');
  const [autoPoll, setAutoPoll] = useState<boolean>(false);
  const [tick, setTick] = useState<number>(0);
  const [ticking, setTicking] = useState<boolean>(false);
  const [spills, setSpills] = useState<Record<string, ActiveSpill>>({});
  const [eventLog, setEventLog] = useState<SpilloverEvent[]>([]);
  const [live, setLive] = useState<LiveSnapshot | null>(null);
  const [liveLoading, setLiveLoading] = useState<boolean>(false);
  const tickRef = useRef(0);

  const refreshLive = useCallback(async () => {
    if (!lastResult || neighborhoods.length === 0) return;
    setLiveLoading(true);
    try {
      const snap = await fetchLiveSnapshot(neighborhoods, lastResult.warehouses, config);
      setLive(snap);
    } finally {
      setLiveLoading(false);
    }
  }, [neighborhoods, lastResult, config]);

  const runTick = useCallback(async (overrides?: Record<string, number>) => {
    if (!lastResult || ticking) return;
    setTicking(true);
    try {
      const next = tickRef.current + 1;
      const res = await runSimulationTick({
        neighborhoods,
        warehouses: lastResult.warehouses,
        assignments: lastResult.assignments,
        config: { ...config, simulation_mode: simMode },
        tick: next,
        active_spills: spills,
        congestion_overrides: overrides ?? null,
        scale_demand: true,
        demand_amplitude: 1.0,
        simulate_surge: !overrides
      });
      tickRef.current = next;
      setTick(next);
      setSpills(res.active_spills || {});
      if (res.events && res.events.length > 0) {
        setEventLog((prev) => [...res.events, ...prev].slice(0, 50));
      }
      // Apply the tick to the live network: scaled demand + spilled assignments.
      onUpdateNeighborhoods(res.neighborhoods);
      if (res.assignments && res.assignments.length > 0) {
        onOptimizationComplete({
          ...lastResult,
          assignments: res.assignments,
          metrics: res.metrics || lastResult.metrics,
          traffic_note: res.traffic_note || lastResult.traffic_note,
          fuel_note: res.fuel_note || lastResult.fuel_note
        });
      }
      await refreshLive();
    } catch (e) {
      console.error('Simulation tick failed', e);
    } finally {
      setTicking(false);
    }
  }, [lastResult, ticking, neighborhoods, config, simMode, spills, onUpdateNeighborhoods, onOptimizationComplete, refreshLive]);

  const handleSimMode = (m: 'off' | 'realtime') => {
    setSimMode(m);
    onUpdateConfig({ ...config, simulation_mode: m });
    if (m === 'off') setAutoPoll(false);
  };

  // Auto poll tick every 15s while realtime + auto is on.
  useEffect(() => {
    if (simMode !== 'realtime' || !autoPoll || !lastResult) return;
    const id = window.setInterval(() => { runTick(); }, 15000);
    return () => window.clearInterval(id);
  }, [simMode, autoPoll, lastResult, runTick]);

  // Keep the live snapshot fresh whenever the result changes.
  useEffect(() => {
    refreshLive();
  }, [lastResult, refreshLive]);

  // Effective traffic for ETA: live feed wins in realtime mode, manual slider otherwise.
  const effectiveTrafficPct = simMode === 'realtime' && live
    ? Math.round((live.traffic.avg_congestion_pct || 0) * 100)
    : trafficPct;

  // Compute Trade-off Curve
  const runTradeoffAnalysis = async (costVal: number, kVal: number) => {
    setIsTradeoffLoading(true);
    try {
      const cfg: OptimizationConfig = {
        ...config,
        infra_cost_per_warehouse: costVal
      };
      const res = await getTradeoffCurve(neighborhoods, cfg, kVal);
      setTradeoffResult(res);
    } catch (e) {
      console.error('Tradeoff calculation failed', e);
    } finally {
      setIsTradeoffLoading(false);
    }
  };

  useEffect(() => {
    runTradeoffAnalysis(infraCost, maxKEval);
  }, [infraCost, maxKEval, neighborhoods]);

  // Compute Fleet ETA whenever assignments, vehicle, or traffic changes.
  // In realtime mode the ETA reads the live feed tick (no sliders in the path).
  useEffect(() => {
    if (!lastResult || !lastResult.assignments) return;

    const liveTraffic = simMode === 'realtime' && live ? live.traffic.avg_congestion_pct : trafficPct / 100.0;
    const currentConfig: OptimizationConfig = {
      ...config,
      traffic_factor: liveTraffic,
      fuel_cost_per_km: fuelCost,
      use_live_fuel: simMode === 'realtime' ? true : liveFuel,
      fuel_state: 'Karnataka',
      fuel_city: fuelCity || null
    };

    getFleetETA(lastResult.assignments, currentConfig, selectedVehicle).then(setFleetETA);
  }, [lastResult, trafficPct, selectedVehicle, fuelCost, liveFuel, fuelCity, simMode, live]);

  // Compute Diagnostics whenever result changes
  useEffect(() => {
    if (!lastResult) return;
    getConstraintDiagnostics(lastResult.warehouses, lastResult.assignments, lastResult.config).then(setDiagnostics);
  }, [lastResult]);

  // Handle Demand Shift Application
  const handleApplyDemandShift = async () => {
    setIsShiftApplying(true);
    try {
      const { neighborhoods: shifted } = await applyDemandShift(neighborhoods, demandShiftPct);
      onUpdateNeighborhoods(shifted);

      // Re-run optimization with current config
      const optResult = await optimizeNetwork(shifted, config);
      onOptimizationComplete(optResult);
    } catch (e) {
      console.error('Failed to apply demand shift', e);
    } finally {
      setIsShiftApplying(false);
    }
  };

  // Preset chips for demand shift
  const DEMAND_PRESETS = [
    { label: '-30% Slump', val: -30 },
    { label: 'Baseline (0%)', val: 0 },
    { label: '+25% Peak', val: 25 },
    { label: '+50% Festive', val: 50 },
    { label: '+100% 2x Demand', val: 100 }
  ];

  const totalDemand = useMemo(() => {
    return neighborhoods.reduce((s, n) => s + (Number(n.daily_orders) || 0), 0);
  }, [neighborhoods]);

  const shiftedTotalDemand = useMemo(() => {
    return Math.round(totalDemand * (1 + demandShiftPct / 100));
  }, [totalDemand, demandShiftPct]);

  return (
    <div className="space-y-4 pb-8">
      {/* Top Banner */}
      <div className="card p-5">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-gold-100 text-gold-600 text-xs font-bold mb-2.5">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Scenario Lab</span>
        </div>
        <h2 className="font-display font-semibold text-[22px] text-ink leading-tight">
          Stress-test your supply network
        </h2>
        <p className="text-ink-faint text-[13px] mt-1.5 leading-relaxed">
          Trade infrastructure cost against route mileage, simulate demand shifts,
          estimate traffic-impacted ETAs, and audit constraint violations.
          Flip realtime ON and the lab drives itself from live fuel, traffic and demand feeds.
        </p>
      </div>

      {/* Phase F: Realtime automation — live feeds + spillover, sliders demoted */}
      <div className="card p-4">
        <div className="flex items-center justify-between pb-4 border-b border-[#E4E1D2]">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${simMode === 'realtime' ? 'bg-cream-deep text-ink' : 'bg-cream-deep text-ink-faint'}`}>
              <Satellite className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink">Realtime Automation</h3>
              <p className="text-xs text-ink-faint">Live fuel + traffic + demand tick · congestion spillover with event log</p>
            </div>
          </div>
          <div className="flex items-center bg-cream-deep border border-[#E4E1D2] rounded-full p-1 text-[12px]">
            {(['off', 'realtime'] as const).map((m) => (
              <button
                key={m}
                onClick={() => handleSimMode(m)}
                className={`px-3 py-1.5 rounded-full font-bold capitalize transition cursor-pointer ${simMode === m ? 'bg-[#14424E] text-white' : 'text-ink-faint hover:text-ink'}`}
              >
                {m === 'off' ? 'Manual' : 'Realtime'}
              </button>
            ))}
          </div>
        </div>

        <div className="my-4 bg-cream-deep p-4 rounded-2xl border border-[#E4E1D2] space-y-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-semibold text-ink-soft flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              Tick {tick} · {Object.keys(spills).length > 0 ? `${Object.keys(spills).length} warehouse(s) spilling` : 'no active spillover'}
            </span>
            <label className="flex items-center gap-1.5 font-semibold text-ink-soft cursor-pointer">
              <input type="checkbox" checked={autoPoll} onChange={(e) => setAutoPoll(e.target.checked)} disabled={simMode !== 'realtime'} className="rounded" />
              Auto every 15s
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => runTick()}
              disabled={ticking || !lastResult}
              className="px-3 py-1.5 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3 h-3 ${ticking ? 'animate-spin' : ''}`} />
              <span>{ticking ? 'Ticking…' : 'Run tick now'}</span>
            </button>
            <button
              onClick={() => lastResult && runTick({ [lastResult.warehouses[0]?.warehouse_id || 'W1']: 0.9 })}
              disabled={ticking || !lastResult || !lastResult.warehouses.length}
              title="Force 90% congestion on the first warehouse to demo spillover"
              className="px-3 py-1.5 bg-white border border-[#E4E1D2] hover:bg-cream-deep text-ink rounded-full text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              Simulate W1 surge
            </button>
            <button
              onClick={refreshLive}
              disabled={liveLoading || !lastResult}
              className="px-3 py-1.5 bg-white border border-[#E4E1D2] hover:bg-cream-deep text-ink rounded-full text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              {liveLoading ? 'Reading feeds…' : 'Refresh live feeds'}
            </button>
          </div>
          {live && (
            <div className="grid grid-cols-1 gap-2 text-[11px]">
              <div className="bg-white rounded-xl border border-[#E4E1D2] px-3 py-2">
                <span className="font-bold text-ink">Fuel:</span>{' '}
                <span className="text-ink-soft">{live.fuel.note}</span>{' '}
                {live.fuel.live && <span className="font-extrabold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full text-[10px]">LIVE</span>}
              </div>
              <div className="bg-white rounded-xl border border-[#E4E1D2] px-3 py-2">
                <span className="font-bold text-ink">Traffic:</span>{' '}
                <span className="text-ink-soft">{live.traffic.note} · avg +{(live.traffic.avg_congestion_pct * 100).toFixed(0)}%</span>{' '}
                {Object.values(live.traffic.live || {}).some(Boolean) && <span className="font-extrabold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full text-[10px]">LIVE</span>}
                <span className="block mt-1 text-ink-faint">
                  {Object.entries(live.traffic.by_warehouse || {}).map(([w, f]) => `${w} +${(Number(f) * 100).toFixed(0)}%`).join(' · ') || 'No warehouses yet'}
                </span>
              </div>
              <div className="bg-white rounded-xl border border-[#E4E1D2] px-3 py-2">
                <span className="font-bold text-ink">Demand:</span>{' '}
                <span className="text-ink-soft">{live.demand.total_orders.toLocaleString()} orders across {live.demand.nodes} nodes</span>
              </div>
            </div>
          )}
          {!lastResult && (
            <p className="text-[11px] text-ink-faint">Run Optimize first — ticks need warehouses + assignments.</p>
          )}
        </div>

        <div>
          <span className="text-xs font-semibold text-ink-soft block mb-2">Spillover event log {eventLog.length > 0 && `(${eventLog.length})`}</span>
          {eventLog.length === 0 ? (
            <p className="text-[11px] text-ink-faint bg-cream-deep rounded-xl px-3 py-2 border border-[#E4E1D2]">
              No spillover yet. Congestion past {(config.simulation_congestion_threshold ?? 0.5) * 100}% moves nodes to the next-best warehouse until it clears — try “Simulate W1 surge”, then tick again to watch them come home.
            </p>
          ) : (
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {eventLog.map((e, i) => (
                <div key={`${e.tick}-${e.warehouse_id}-${e.kind}-${i}`} className={`text-[11px] rounded-xl px-3 py-2 border ${e.kind === 'spill_start' ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
                  <span className="font-bold">Tick {e.tick} · {e.warehouse_id} · {e.kind === 'spill_start' ? 'spill start' : 'recovered'}</span>
                  <span className="block font-medium">{e.reason}</span>
                  {e.moved_neighborhood_ids.length > 0 && (
                    <span className="block text-[10px] opacity-80">Nodes: {e.moved_neighborhood_ids.slice(0, 8).join(', ')}{e.moved_neighborhood_ids.length > 8 ? ` +${e.moved_neighborhood_ids.length - 8} more` : ''}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stack of Scenarios (single column — sidebar width) */}
      <div className="grid grid-cols-1 gap-4">
        {/* =========================================================================
            CARD 1: Infrastructure vs. Delivery Cost Trade-off (Elbow Curve)
            ========================================================================= */}
        <div className="card p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-[#E4E1D2]">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-grape-100 text-grape-600 flex items-center justify-center font-bold">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink">Infrastructure vs. Delivery Cost (Elbow Curve)</h3>
                  <p className="text-xs text-ink-faint">Find the optimal number of warehouses (K) to balance facility rent with transit cost</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {isTradeoffLoading && (
                  <RefreshCw className="w-3.5 h-3.5 text-grape-500 animate-spin" />
                )}
                {tradeoffResult && (
                  <span className="px-2.5 py-1 rounded-full bg-grape-100 text-grape-600 text-xs font-extrabold border border-grape-200">
                    Optimal K = {tradeoffResult.optimal_K}
                  </span>
                )}
              </div>
            </div>

            {/* Slider Controls */}
            <div className="grid grid-cols-1 gap-3 my-4 bg-cream-deep p-4 rounded-2xl border border-[#E4E1D2]">
              <div>
                <label className="text-xs font-semibold text-ink-soft block mb-1 flex items-center justify-between">
                  <span>Fixed Infra Cost / Hub:</span>
                  <span className="font-bold text-ink">${infraCost}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="3000"
                  step="100"
                  value={infraCost}
                  onChange={(e) => setInfraCost(Number(e.target.value))}
                  className="slider"
                />
                <span className="text-[10px] text-ink-faint block mt-1">$0 to $3,000 / facility</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink-soft block mb-1 flex items-center justify-between">
                  <span>Max K Evaluated:</span>
                  <span className="font-bold text-ink">K={maxKEval}</span>
                </label>
                <input
                  type="range"
                  min="2"
                  max="8"
                  step="1"
                  value={maxKEval}
                  onChange={(e) => setMaxKEval(Number(e.target.value))}
                  className="slider"
                />
                <span className="text-[10px] text-ink-faint block mt-1">Multi-restart K-Means runs</span>
              </div>
            </div>

            {/* Tradeoff Visual Bars */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] font-semibold text-ink-faint uppercase tracking-wider px-1">
                <span>Facilities (K)</span>
                <div className="flex items-center space-x-4">
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#14424E]" />
                    <span>Delivery</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span>Infra</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#14424E]" />
                    <span>Total Cost</span>
                  </span>
                </div>
              </div>

              {tradeoffResult && tradeoffResult.points.map((pt) => {
                const maxTotal = Math.max(...tradeoffResult.points.map(p => p.total_cost), 1);
                const pctDelivery = (pt.delivery_cost / maxTotal) * 100;
                const pctInfra = (pt.infra_cost / maxTotal) * 100;
                const isOptimal = pt.K === tradeoffResult.optimal_K;

                return (
                  <div
                    key={pt.K}
                    className={`p-2.5 rounded-xl border transition-all ${
                      isOptimal
                        ? 'bg-cream-deep border-gold ring-1 ring-gold'
                        : 'bg-white border-[#E4E1D2] hover:bg-cream-deep'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                      <div className="flex items-center space-x-2">
                        <span className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                          isOptimal ? 'bg-[#14424E] text-white' : 'bg-cream-deep text-ink-soft'
                        }`}>
                          {pt.K}
                        </span>
                        <span className="text-ink-soft font-semibold">K = {pt.K} Hubs</span>
                        {isOptimal && (
                          <span className="text-[10px] font-bold text-grape-600 uppercase tracking-wider bg-grape-100 px-1.5 py-0.5 rounded">
                            ★ Sweet Spot
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-extrabold text-ink">${pt.total_cost.toLocaleString()}</span>
                        <span className="text-[10px] text-ink-faint ml-1.5">({pt.avg_distance_km} km/order)</span>
                      </div>
                    </div>

                    {/* Stacked Cost Bar */}
                    <div className="w-full bar-track h-2.5 rounded-full overflow-hidden flex">
                      <div
                        style={{ width: `${pctDelivery}%` }}
                        className="bg-[#14424E] h-full transition-all duration-500"
                        title={`Delivery: $${pt.delivery_cost}`}
                      />
                      <div
                        style={{ width: `${pctInfra}%` }}
                        className="bg-amber-400 h-full transition-all duration-500"
                        title={`Infra: $${pt.infra_cost}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {tradeoffResult && (
            <div className="mt-5 pt-4 border-t border-[#E4E1D2] flex items-center justify-between">
              <span className="text-xs text-ink-faint">
                Switching to recommended <strong>K = {tradeoffResult.optimal_K}</strong> saves transit waste without over-renting facilities.
              </span>
              <button
                onClick={() => {
                  onUpdateConfig({ ...config, K: tradeoffResult.optimal_K, infra_cost_per_warehouse: infraCost });
                }}
                className="px-3 py-1.5 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-semibold transition cursor-pointer"
              >
                Set K = {tradeoffResult.optimal_K}
              </button>
            </div>
          )}
        </div>

        {/* =========================================================================
            CARD 2: Customer Demand Shift & Stress-Test Simulator
            ========================================================================= */}
        <div className="card p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-[#E4E1D2]">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-gold-100 text-gold-600 flex items-center justify-center font-bold">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink">Demand Surge &amp; Contraction Simulator</h3>
                  <p className="text-xs text-ink-faint">Model holiday surges, seasonal expansion, or market downturns</p>
                </div>
              </div>
            </div>

            {/* Manual multiplier — offline override (realtime tick drives the default path) */}
            <details className="my-5 bg-cream-deep rounded-2xl border border-[#E4E1D2]" open={simMode === 'off'}>
              <summary className="px-4 py-3 text-xs font-bold text-ink-soft cursor-pointer list-none flex items-center justify-between">
                <span>Manual demand multiplier (offline override)</span>
                <span className="text-[10px] font-extrabold text-ink-faint bg-white border border-[#E4E1D2] px-2 py-0.5 rounded-full">
                  {simMode === 'realtime' ? 'BYPASSED · TICK DRIVES DEMAND' : 'ACTIVE'}
                </span>
              </summary>
              <div className="px-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-ink-soft">Demand Multiplier (Δ%):</span>
                <span className={`text-sm font-extrabold ${demandShiftPct >= 0 ? 'text-ink' : 'text-rose-600'}`}>
                  {demandShiftPct >= 0 ? `+${demandShiftPct}%` : `${demandShiftPct}%`}
                </span>
              </div>
              <input
                type="range"
                min="-50"
                max="100"
                step="5"
                value={demandShiftPct}
                onChange={(e) => setDemandShiftPct(Number(e.target.value))}
                className="slider"
              />

              {/* Preset Chips */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {DEMAND_PRESETS.map((p) => (
                  <button
                    key={p.val}
                    onClick={() => setDemandShiftPct(p.val)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                      demandShiftPct === p.val
                        ? 'bg-[#14424E] text-white shadow-sm'
                        : 'bg-white border border-[#E4E1D2] text-ink-soft hover:bg-cream-deep'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              </div>
            </details>

            {/* Demand Impact Overview */}
            <div className="grid grid-cols-1 gap-3 mb-4">
              <div className="p-3.5 rounded-2xl bg-cream-deep border border-[#E4E1D2]">
                <span className="text-[11px] font-medium text-ink-faint block">Baseline Total Orders</span>
                <span className="text-lg font-extrabold text-ink-soft">{totalDemand.toLocaleString()}</span>
                <span className="text-[10px] text-ink-faint block mt-0.5">Across {neighborhoods.length} zones</span>
              </div>
              <div className="panel-well p-3.5">
                <span className="text-[11px] font-medium text-ink-faint block">Projected Volume</span>
                <span className="text-lg font-extrabold text-ink">{shiftedTotalDemand.toLocaleString()}</span>
                <span className="text-[10px] text-ink-soft font-semibold block mt-0.5">
                  {demandShiftPct >= 0 ? `+${shiftedTotalDemand - totalDemand}` : `${shiftedTotalDemand - totalDemand}`} orders
                </span>
              </div>
            </div>

            <div className="text-xs text-ink-faint bg-amber-50/70 border border-amber-200 p-3 rounded-xl">
              💡 <strong>Impact Insight:</strong> Shifting volume adjusts the Weiszfeld geometric medoids toward high-demand clusters and tests whether your warehouses breach the {config.C_max ? `${config.C_max} order C_max limit` : 'capacity threshold'}.
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#E4E1D2]">
            <button
              onClick={handleApplyDemandShift}
              disabled={isShiftApplying}
              className="w-full py-2.5 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isShiftApplying ? 'animate-spin' : ''}`} />
              <span>{isShiftApplying ? 'Simulating...' : `Apply Shift (${demandShiftPct >= 0 ? `+${demandShiftPct}%` : `${demandShiftPct}%`}) & Re-Optimize Network`}</span>
            </button>
          </div>
        </div>

        {/* =========================================================================
            CARD 3: Traffic Congestion & Fleet Delivery ETA Calculator
            ========================================================================= */}
        <div className="card p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-[#E4E1D2]">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-cream-deep text-ink flex items-center justify-center font-bold">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink">
                    Traffic Congestion &amp; Fleet ETA{' '}
                    {simMode === 'realtime' ? (
                      <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">LIVE AUTO</span>
                    ) : (
                      <span className="text-[10px] font-extrabold text-ink-faint bg-cream-deep border border-[#E4E1D2] px-1.5 py-0.5 rounded-full">MANUAL</span>
                    )}
                  </h3>
                  <p className="text-xs text-ink-faint">
                    {simMode === 'realtime'
                      ? `Live tick drives ETA (corridors +${effectiveTrafficPct}%) — sliders below are offline overrides`
                      : 'Calculate delivery duration, vehicle trips, and fuel burn under congestion'}
                  </p>
                </div>
              </div>
            </div>

            {/* Vehicle Mode Tabs */}
            <div className="grid grid-cols-3 gap-2 my-4">
              {[
                { id: 'bike', label: 'E-Bike', desc: '25 km/h • 30 cap', icon: Zap },
                { id: 'van', label: 'Delivery Van', desc: '40 km/h • 120 cap', icon: Truck },
                { id: 'truck', label: 'Heavy Truck', desc: '30 km/h • 500 cap', icon: Layers }
              ].map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVehicle(v.id as any)}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    selectedVehicle === v.id
                      ? 'bg-cream-deep border-gold ring-1 ring-gold'
                      : 'bg-white border-[#E4E1D2] hover:bg-cream-deep'
                  }`}
                >
                  <span className="text-xs font-bold text-ink block">{v.label}</span>
                  <span className="text-[10px] text-ink-faint block mt-0.5">{v.desc}</span>
                </button>
              ))}
            </div>

            {/* Manual traffic + fuel sliders — offline overrides (live tick drives the default path) */}
            <details className="bg-cream-deep rounded-2xl border border-[#E4E1D2] mb-4" open={simMode === 'off'}>
              <summary className="px-4 py-3 text-xs font-bold text-ink-soft cursor-pointer list-none flex items-center justify-between">
                <span>Manual congestion &amp; fuel sliders (offline overrides)</span>
                <span className="text-[10px] font-extrabold text-ink-faint bg-white border border-[#E4E1D2] px-2 py-0.5 rounded-full">
                  {simMode === 'realtime' ? 'BYPASSED · TICK DRIVES ETA' : 'ACTIVE'}
                </span>
              </summary>
              <div className="px-4 pb-4 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-ink-soft flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5 text-ink-soft" />
                    <span>Rush-Hour Traffic Congestion Factor:</span>
                  </span>
                  <span className="text-xs font-extrabold text-ink">+{trafficPct}% Delay</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={trafficPct}
                  onChange={(e) => setTrafficPct(Number(e.target.value))}
                  className="slider"
                />
                <div className="flex justify-between text-[10px] text-ink-faint mt-0.5">
                  <span>0% (Free Flow)</span>
                  <span>50% (Peak Hour)</span>
                  <span>100% (Gridlock)</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-ink-soft flex items-center space-x-1">
                    <Fuel className="w-3.5 h-3.5 text-amber-600" />
                    <span>Fuel Price Surcharge ($/km):</span>
                  </span>
                  <span className="text-xs font-extrabold text-amber-700">${fuelCost.toFixed(2)}/km</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.5"
                  step="0.05"
                  value={fuelCost}
                  onChange={(e) => setFuelCost(Number(e.target.value))}
                  className="slider"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={liveFuel}
                    onChange={(e) => setLiveFuel(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  Live pump prices (Karnataka)
                </label>
                {liveFuel && (
                  <input
                    type="text"
                    value={fuelCity}
                    onChange={(e) => setFuelCity(e.target.value)}
                    placeholder="City (e.g. Bengaluru)"
                    className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px]"
                  />
                )}
              </div>
              </div>
            </details>

            {/* ETA & Fuel Metrics */}
            {fleetETA && (
              <div className="grid grid-cols-1 gap-2.5">
                <div className="bg-cream-deep p-3 rounded-2xl border border-[#E4E1D2] text-center">
                  <span className="text-[10px] font-semibold text-ink-faint uppercase block">Avg ETA / Drop</span>
                  <span className="text-base font-extrabold text-ink">{fleetETA.avg_eta_minutes} min</span>
                  <span className="text-[10px] text-ink-faint block mt-0.5">
                    Max {fleetETA.max_eta_minutes} min
                    {fleetETA.effective_congestion_pct != null && fleetETA.effective_congestion_pct > 0
                      ? ` • +${fleetETA.effective_congestion_pct}% corridors`
                      : ''}
                  </span>
                </div>
                <div className="bg-cream-deep p-3 rounded-2xl border border-[#E4E1D2] text-center">
                  <span className="text-[10px] font-semibold text-ink-faint uppercase block">Total Vehicle Trips</span>
                  <span className="text-base font-extrabold text-ink">{fleetETA.total_trips}</span>
                  <span className="text-[10px] text-ink-faint block mt-0.5">Batch dispatched</span>
                </div>
                <div className="bg-cream-deep p-3 rounded-2xl border border-[#E4E1D2] text-center">
                  <span className="text-[10px] font-semibold text-ink-faint uppercase block">Fuel Burned</span>
                  <span className="text-base font-extrabold text-amber-600">{fleetETA.fuel_consumed_liters} L</span>
                  <span className="text-[10px] text-ink-faint block mt-0.5">
                    {fleetETA.fuel_cost != null && fleetETA.fuel_cost > 0
                      ? `$${fleetETA.fuel_cost.toLocaleString()} @ ₹${fleetETA.fuel_price_per_litre?.toFixed(2)}/L${fleetETA.fuel_live ? ' • live' : ''}`
                      : `${fleetETA.effective_km} km dist`}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-[#E4E1D2] flex items-center justify-between">
            <span className="text-xs text-ink-faint">
              Save traffic factor <strong>{(effectiveTrafficPct / 100).toFixed(2)}</strong>{simMode === 'realtime' ? ' (live tick)' : ''} to main config:
            </span>
            <button
              onClick={() => {
                onUpdateConfig({
                  ...config,
                  traffic_factor: effectiveTrafficPct / 100.0,
                  fuel_cost_per_km: fuelCost,
                  use_live_fuel: liveFuel,
                  fuel_state: 'Karnataka',
                  fuel_city: fuelCity || null
                });
              }}
              className="px-3 py-1.5 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Update Fleet Parameters
            </button>
          </div>
        </div>

        {/* =========================================================================
            CARD 4: Capacity & Service Radius Violation Center
            ========================================================================= */}
        <div className="card p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-[#E4E1D2]">
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                  diagnostics?.is_compliant
                    ? 'bg-cream-deep text-ink'
                    : 'bg-rose-50 text-rose-600'
                }`}>
                  {diagnostics?.is_compliant ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink">Capacity &amp; Radius Diagnostics</h3>
                  <p className="text-xs text-ink-faint">Monitor warehouse utilization levels and detect coverage range breaches</p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-extrabold border ${
                diagnostics?.is_compliant
                  ? 'bg-grape-100 text-grape-600 border-grape-200'
                  : 'bg-rose-100 text-rose-800 border-rose-200'
              }`}>
                {diagnostics?.is_compliant ? '100% Compliant' : `${diagnostics?.total_violations} Violations`}
              </span>
            </div>

            {/* Warehouse Utilization Bars */}
            <div className="my-4 space-y-3">
              <span className="text-xs font-semibold text-ink-soft block">Warehouse Utilization Status:</span>
              {lastResult?.warehouses.map((w) => {
                const assigned = w.assigned_orders || 0;
                const cMax = config.capacity_enabled ? (config.C_max || 1000) : null;
                const utilPct = cMax ? (assigned / cMax) * 100 : null;
                const isOver = cMax ? assigned > cMax : false;

                return (
                  <div key={w.warehouse_id} className="bg-cream-deep p-3 rounded-2xl border border-[#E4E1D2]">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-bold text-ink-soft">{w.warehouse_id}</span>
                      <span className="text-ink-soft font-medium">
                        {assigned.toLocaleString()} orders
                        {cMax && ` / ${cMax} max (${utilPct?.toFixed(1)}%)`}
                      </span>
                    </div>
                    {cMax && (
                      <div className="w-full bar-track h-2 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${Math.min(100, utilPct || 0)}%` }}
                          className={`h-full transition-all ${
                            isOver ? 'bg-rose-500' : (utilPct || 0) > 85 ? 'bg-amber-500' : 'bg-[#14424E]'
                          }`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Radius Violations List */}
            {diagnostics && diagnostics.radius_violations.length > 0 && (
              <div className="mt-4 p-3.5 bg-rose-50 border border-rose-200 rounded-2xl space-y-2">
                <span className="text-xs font-bold text-rose-900 block flex items-center space-x-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  <span>Radius Breaches Exceeding R_max ({config.R_max_km} km):</span>
                </span>
                <div className="max-h-24 overflow-y-auto space-y-1 text-[11px] text-rose-800 pr-1">
                  {diagnostics.radius_violations.map((rv, idx) => (
                    <div key={idx} className="flex justify-between py-0.5 border-b border-rose-100 last:border-none">
                      <span>Node {rv.neighborhood_id} &rarr; {rv.warehouse_id}</span>
                      <span className="font-bold">{rv.distance_km} km (+{rv.overage_km} km over)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-[#E4E1D2] flex items-center justify-between">
            <span className="text-xs text-ink-faint">
              Inspect full spider vectors and radius zones in Map Visualizer:
            </span>
            <button
              onClick={onGoToMap}
              className="px-3 py-1.5 bg-cream-deep hover:bg-gold-100 text-ink rounded-full text-xs font-semibold transition cursor-pointer flex items-center space-x-1"
            >
              <span>View On Map</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
