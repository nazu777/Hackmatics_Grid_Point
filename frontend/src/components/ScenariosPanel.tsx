import React, { useState, useEffect, useMemo } from 'react';
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
  ArrowRight
} from 'lucide-react';
import {
  Neighborhood,
  OptimizationConfig,
  OptimizationResult,
  TradeoffResult,
  FleetETAResult,
  ConstraintDiagnostics
} from '../types';
import {
  getTradeoffCurve,
  applyDemandShift,
  getFleetETA,
  getConstraintDiagnostics,
  optimizeNetwork
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
  const [fleetETA, setFleetETA] = useState<FleetETAResult | null>(null);

  // Scenario 4: Diagnostics State
  const [diagnostics, setDiagnostics] = useState<ConstraintDiagnostics | null>(null);

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

  // Compute Fleet ETA whenever assignments, vehicle, or traffic changes
  useEffect(() => {
    if (!lastResult || !lastResult.assignments) return;

    const currentConfig: OptimizationConfig = {
      ...config,
      traffic_factor: trafficPct / 100.0,
      fuel_cost_per_km: fuelCost
    };

    getFleetETA(lastResult.assignments, currentConfig, selectedVehicle).then(setFleetETA);
  }, [lastResult, trafficPct, selectedVehicle, fuelCost]);

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
    <div className="space-y-8 pb-12">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-slate-900 to-emerald-950 rounded-3xl p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold mb-3 border border-emerald-500/30">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Phase 5 &bull; Advanced Decision-Support & Bonus Scenarios</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight">
            Stress-Test &amp; Refine Your Supply Network
          </h2>
          <p className="text-slate-300 text-sm mt-2 leading-relaxed">
            Simulate realistic logistics scenarios: trade off fixed infrastructure cost against route mileage,
            stress-test customer demand shifts, calculate traffic-impacted delivery ETAs, and audit constraint violations.
          </p>
        </div>
      </div>

      {/* Grid of Scenarios */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* =========================================================================
            CARD 1: Infrastructure vs. Delivery Cost Trade-off (Elbow Curve)
            ========================================================================= */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Infrastructure vs. Delivery Cost (Elbow Curve)</h3>
                  <p className="text-xs text-slate-500">Find the optimal number of warehouses (K) to balance facility rent with transit cost</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {isTradeoffLoading && (
                  <RefreshCw className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                )}
                {tradeoffResult && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-extrabold border border-emerald-200">
                    Optimal K = {tradeoffResult.optimal_K}
                  </span>
                )}
              </div>
            </div>

            {/* Slider Controls */}
            <div className="grid grid-cols-2 gap-4 my-5 bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1 flex items-center justify-between">
                  <span>Fixed Infra Cost / Hub:</span>
                  <span className="font-bold text-indigo-700">${infraCost}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="3000"
                  step="100"
                  value={infraCost}
                  onChange={(e) => setInfraCost(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <span className="text-[10px] text-slate-400 block mt-1">$0 to $3,000 / facility</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1 flex items-center justify-between">
                  <span>Max K Evaluated:</span>
                  <span className="font-bold text-indigo-700">K={maxKEval}</span>
                </label>
                <input
                  type="range"
                  min="2"
                  max="8"
                  step="1"
                  value={maxKEval}
                  onChange={(e) => setMaxKEval(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <span className="text-[10px] text-slate-400 block mt-1">Multi-restart K-Means runs</span>
              </div>
            </div>

            {/* Tradeoff Visual Bars */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-1">
                <span>Facilities (K)</span>
                <div className="flex items-center space-x-4">
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span>Delivery</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span>Infra</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
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
                        ? 'bg-emerald-50/60 border-emerald-300 ring-1 ring-emerald-400'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                      <div className="flex items-center space-x-2">
                        <span className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                          isOptimal ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {pt.K}
                        </span>
                        <span className="text-slate-800 font-semibold">K = {pt.K} Hubs</span>
                        {isOptimal && (
                          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider bg-emerald-100 px-1.5 py-0.5 rounded">
                            ★ Sweet Spot
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-extrabold text-slate-900">${pt.total_cost.toLocaleString()}</span>
                        <span className="text-[10px] text-slate-400 ml-1.5">({pt.avg_distance_km} km/order)</span>
                      </div>
                    </div>

                    {/* Stacked Cost Bar */}
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden flex">
                      <div
                        style={{ width: `${pctDelivery}%` }}
                        className="bg-emerald-500 h-full transition-all duration-500"
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
            <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Switching to recommended <strong>K = {tradeoffResult.optimal_K}</strong> saves transit waste without over-renting facilities.
              </span>
              <button
                onClick={() => {
                  onUpdateConfig({ ...config, K: tradeoffResult.optimal_K, infra_cost_per_warehouse: infraCost });
                }}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Set K = {tradeoffResult.optimal_K}
              </button>
            </div>
          )}
        </div>

        {/* =========================================================================
            CARD 2: Customer Demand Shift & Stress-Test Simulator
            ========================================================================= */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Demand Surge &amp; Contraction Simulator</h3>
                  <p className="text-xs text-slate-500">Model holiday surges, seasonal expansion, or market downturns</p>
                </div>
              </div>
            </div>

            {/* Slider */}
            <div className="my-5 bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-700">Demand Multiplier (Δ%):</span>
                <span className={`text-sm font-extrabold ${demandShiftPct >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
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
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
              />

              {/* Preset Chips */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {DEMAND_PRESETS.map((p) => (
                  <button
                    key={p.val}
                    onClick={() => setDemandShiftPct(p.val)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                      demandShiftPct === p.val
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Demand Impact Overview */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] font-medium text-slate-500 block">Baseline Total Orders</span>
                <span className="text-lg font-extrabold text-slate-800">{totalDemand.toLocaleString()}</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">Across {neighborhoods.length} zones</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200">
                <span className="text-[11px] font-medium text-emerald-700 block">Projected Volume</span>
                <span className="text-lg font-extrabold text-emerald-900">{shiftedTotalDemand.toLocaleString()}</span>
                <span className="text-[10px] text-emerald-600 font-semibold block mt-0.5">
                  {demandShiftPct >= 0 ? `+${shiftedTotalDemand - totalDemand}` : `${shiftedTotalDemand - totalDemand}`} orders
                </span>
              </div>
            </div>

            <div className="text-xs text-slate-500 bg-amber-50/70 border border-amber-200 p-3 rounded-xl">
              💡 <strong>Impact Insight:</strong> Shifting volume adjusts the Weiszfeld geometric medoids toward high-demand clusters and tests whether your warehouses breach the {config.C_max ? `${config.C_max} order C_max limit` : 'capacity threshold'}.
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100">
            <button
              onClick={handleApplyDemandShift}
              disabled={isShiftApplying}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isShiftApplying ? 'animate-spin' : ''}`} />
              <span>{isShiftApplying ? 'Simulating...' : `Apply Shift (${demandShiftPct >= 0 ? `+${demandShiftPct}%` : `${demandShiftPct}%`}) & Re-Optimize Network`}</span>
            </button>
          </div>
        </div>

        {/* =========================================================================
            CARD 3: Traffic Congestion & Fleet Delivery ETA Calculator
            ========================================================================= */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Traffic Congestion &amp; Fleet ETA</h3>
                  <p className="text-xs text-slate-500">Calculate delivery duration, vehicle trips, and fuel burn under congestion</p>
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
                      ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-400'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-xs font-bold text-slate-900 block">{v.label}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">{v.desc}</span>
                </button>
              ))}
            </div>

            {/* Traffic Slider */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-4 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-700 flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                    <span>Rush-Hour Traffic Congestion Factor:</span>
                  </span>
                  <span className="text-xs font-extrabold text-blue-700">+{trafficPct}% Delay</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={trafficPct}
                  onChange={(e) => setTrafficPct(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>0% (Free Flow)</span>
                  <span>50% (Peak Hour)</span>
                  <span>100% (Gridlock)</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-700 flex items-center space-x-1">
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
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
                />
              </div>
            </div>

            {/* ETA & Fuel Metrics */}
            {fleetETA && (
              <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-center">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase block">Avg ETA / Drop</span>
                  <span className="text-base font-extrabold text-slate-900">{fleetETA.avg_eta_minutes} min</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Max {fleetETA.max_eta_minutes} min</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-center">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase block">Total Vehicle Trips</span>
                  <span className="text-base font-extrabold text-slate-900">{fleetETA.total_trips}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Batch dispatched</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-center">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase block">Fuel Burned</span>
                  <span className="text-base font-extrabold text-amber-600">{fleetETA.fuel_consumed_liters} L</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">{fleetETA.effective_km} km dist</span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Save traffic factor <strong>{(trafficPct / 100).toFixed(2)}</strong> to main config:
            </span>
            <button
              onClick={() => {
                onUpdateConfig({
                  ...config,
                  traffic_factor: trafficPct / 100.0,
                  fuel_cost_per_km: fuelCost
                });
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Update Fleet Parameters
            </button>
          </div>
        </div>

        {/* =========================================================================
            CARD 4: Capacity & Service Radius Violation Center
            ========================================================================= */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                  diagnostics?.is_compliant
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-rose-50 text-rose-600'
                }`}>
                  {diagnostics?.is_compliant ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Capacity &amp; Radius Diagnostics</h3>
                  <p className="text-xs text-slate-500">Monitor warehouse utilization levels and detect coverage range breaches</p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-extrabold border ${
                diagnostics?.is_compliant
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                  : 'bg-rose-100 text-rose-800 border-rose-200'
              }`}>
                {diagnostics?.is_compliant ? '100% Compliant' : `${diagnostics?.total_violations} Violations`}
              </span>
            </div>

            {/* Warehouse Utilization Bars */}
            <div className="my-4 space-y-3">
              <span className="text-xs font-semibold text-slate-700 block">Warehouse Utilization Status:</span>
              {lastResult?.warehouses.map((w) => {
                const assigned = w.assigned_orders || 0;
                const cMax = config.capacity_enabled ? (config.C_max || 1000) : null;
                const utilPct = cMax ? (assigned / cMax) * 100 : null;
                const isOver = cMax ? assigned > cMax : false;

                return (
                  <div key={w.warehouse_id} className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-bold text-slate-800">{w.warehouse_id}</span>
                      <span className="text-slate-600 font-medium">
                        {assigned.toLocaleString()} orders
                        {cMax && ` / ${cMax} max (${utilPct?.toFixed(1)}%)`}
                      </span>
                    </div>
                    {cMax && (
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${Math.min(100, utilPct || 0)}%` }}
                          className={`h-full transition-all ${
                            isOver ? 'bg-rose-500' : (utilPct || 0) > 85 ? 'bg-amber-500' : 'bg-emerald-500'
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

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Inspect full spider vectors and radius zones in Map Visualizer:
            </span>
            <button
              onClick={onGoToMap}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-1"
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
