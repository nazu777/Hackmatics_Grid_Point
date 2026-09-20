import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, Zap, TrendingDown, DollarSign, ArrowRight, Route } from 'lucide-react';
import { Neighborhood, OptimizationConfig, OptimizationResult } from '../types';
import { optimizeNetwork, rerouteOnTraffic, type RerouteResult } from '../services/api';
import { FuelCard } from './FuelCard';
import { TrafficCard } from './TrafficCard';
import { WarehouseExpansion } from './WarehouseExpansion';
import { smartDefaults } from './panelStore';

interface OptimizationPanelProps {
  neighborhoods: Neighborhood[];
  onOptimizationComplete: (result: OptimizationResult) => void;
  lastResult: OptimizationResult | null;
  onGoToComparison?: () => void;
}

export const OptimizationPanel: React.FC<OptimizationPanelProps> = ({
  neighborhoods,
  onOptimizationComplete,
  lastResult,
  onGoToComparison
}) => {
  const [config, setConfig] = useState<OptimizationConfig>(() => ({
    K: 2,
    distance_metric: 'haversine',
    capacity_enabled: false,
    C_max: 500,
    radius_enabled: false,
    R_max_km: 15.0,
    cost_per_km: 1.0,
    fuel_cost_per_km: 0.0,
    infra_cost_per_warehouse: 0.0,
    traffic_factor: 0.0,
    use_live_fuel: false,
    fuel_state: 'Karnataka',
    fuel_city: null,
    use_live_traffic: false,
    traffic_hour: null,
    use_live_traffic_for_routing: false,
    traffic_aware_reroute: false,
    vehicle_fleet: [],
    random_seed: 42,
    baseline_mode: 'centroid',
    // Fresh panel: capacity, radius, live fuel + live traffic ON by default,
    // capacity sized to the loaded demand so the first run stays feasible.
    ...smartDefaults(neighborhoods, 2)
  }));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [reroute, setReroute] = useState<RerouteResult | null>(null);
  const [rerouteError, setRerouteError] = useState<string | null>(null);

  const totalDemand = neighborhoods.reduce((sum, n) => sum + (Number(n.daily_orders) || 0), 0);

  const handleRunOptimization = async () => {
    if (neighborhoods.length === 0) {
      setError('Please load or create neighborhoods first before running optimization.');
      return;
    }
    setLoading(true);
    setError(null);
    setReroute(null);
    setRerouteError(null);
    try {
      const result = await optimizeNetwork(neighborhoods, config);
      onOptimizationComplete(result);
    } catch (err: any) {
      setError(err.message || 'Optimization failed');
    } finally {
      setLoading(false);
    }
  };

  const handleReroute = async () => {
    if (!lastResult || lastResult.warehouses.length < 2) return;
    setRerouting(true);
    setRerouteError(null);
    try {
      const res = await rerouteOnTraffic({
        neighborhoods,
        warehouses: lastResult.warehouses,
        assignments: lastResult.assignments,
        config,
        alpha: 1.0,
        beta_per_min: 0.5
      });
      setReroute(res);
    } catch (err: any) {
      setRerouteError(err.message || 'Reroute failed');
    } finally {
      setRerouting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Control Configuration Card */}
      <div className="card p-5">
        <div className="flex flex-col justify-between gap-3 pb-4 border-b border-[#E4E1D2]">
          <div>
            <h2 className="font-display font-semibold text-[20px] text-ink leading-tight">
              Optimization Engine
            </h2>
            <p className="text-xs text-ink-faint mt-0.5">
              Weiszfeld (K=1) • Weighted K-Means (K&gt;1) • PuLP CFLP
            </p>
          </div>

          <button
            onClick={handleRunOptimization}
            disabled={loading || neighborhoods.length === 0}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[#14424E] hover:bg-[#0d333d] disabled:opacity-50 text-white rounded-full text-xs font-bold transition cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            <span>{loading ? 'Optimizing Network...' : 'Run Warehouse Optimization'}</span>
          </button>
        </div>

        {/* Parameters Grid */}
        <div className="grid grid-cols-1 gap-4 pt-4 text-xs">
          {/* Column 1: K & Metric */}
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-ink-soft">Number of Warehouses (K)</span>
                <span className="font-mono text-ink font-bold text-sm">{config.K}</span>
              </div>
              <input
                type="range"
                min="1"
                max={Math.min(10, Math.max(1, neighborhoods.length))}
                value={config.K}
                onChange={(e) => setConfig({ ...config, K: parseInt(e.target.value) })}
                className="slider"
                aria-label="Number of warehouses"
              />
              <span className="text-[11px] text-ink-faint">
                {config.K === 1 ? 'K=1: weighted geometric median (Weiszfeld)' : 'K>1: Weighted K-Means + cluster medians'}
              </span>
            </div>

            <div>
              <label className="font-semibold text-ink-soft block mb-1">Distance Metric</label>
              <select
                value={config.distance_metric}
                onChange={(e) => setConfig({ ...config, distance_metric: e.target.value as any })}
                className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-3 py-2 text-xs text-ink focus:outline-none focus:border-gold"
              >
                <option value="haversine">Haversine (Great-Circle / Spherical)</option>
                <option value="euclidean">Euclidean (Planar Equirectangular)</option>
                <option value="manhattan">Manhattan (Grid / City-Block Routing)</option>
                <option value="road">Road network (TomTom live / OSRM)</option>
              </select>
              {config.distance_metric === 'road' && (
                <p className="text-[10px] text-ink-faint mt-1">
                  Real driving distances + travel times. Slower on large datasets; falls back to straight-line per segment if unreachable.
                </p>
              )}
            </div>
          </div>

          {/* Column 2: Capacity & Radius Constraints */}
          <div className="panel-well p-4 space-y-3">
            <span className="font-bold text-ink uppercase tracking-wider text-[11px] block">
              Operational Constraints (CFLP)
            </span>

            {/* Capacity Toggle */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                <input
                  type="checkbox"
                  checked={config.capacity_enabled}
                  onChange={(e) => setConfig({ ...config, capacity_enabled: e.target.checked })}
                  className="check"
                />
                <span className="font-medium text-ink-soft">Enforce Warehouse Capacity (C_max)</span>
              </label>
              {config.capacity_enabled && (
                <div className="pl-6 space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="10"
                      value={config.C_max || 500}
                      onChange={(e) => setConfig({ ...config, C_max: parseInt(e.target.value) || 100 })}
                      className="w-24 bg-cream-deep border border-[#E4E1D2] rounded-lg px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:border-gold"
                    />
                    <span className="text-[11px] text-ink-faint">orders / warehouse</span>
                  </div>
                  <p className="text-[10px] text-ink-faint">Total capacity: {config.K * (config.C_max || 0)} orders (Demand: {totalDemand})</p>
                </div>
              )}
            </div>

            {/* Radius Toggle */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                <input
                  type="checkbox"
                  checked={config.radius_enabled}
                  onChange={(e) => setConfig({ ...config, radius_enabled: e.target.checked })}
                  className="check"
                />
                <span className="font-medium text-ink-soft">Max Service Radius (R_max)</span>
              </label>
              {config.radius_enabled && (
                <div className="pl-6 flex items-center gap-2">
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={config.R_max_km || 15.0}
                    onChange={(e) => setConfig({ ...config, R_max_km: parseFloat(e.target.value) || 10.0 })}
                    className="w-24 bg-cream-deep border border-[#E4E1D2] rounded-lg px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:border-gold"
                  />
                  <span className="text-[11px] text-ink-faint">km max delivery radius</span>
                </div>
              )}
            </div>
          </div>

          {/* Column 3: Cost & Baseline */}
          <div className="space-y-3">
            <div>
              <label className="font-semibold text-ink-soft block mb-1">Delivery Cost Rate ($/km&bull;order)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={config.cost_per_km}
                onChange={(e) => setConfig({ ...config, cost_per_km: parseFloat(e.target.value) || 1.0 })}
                className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-gold"
              />
            </div>

            <div>
              <label className="font-semibold text-ink-soft block mb-1">Baseline Comparison Mode</label>
              <select
                value={config.baseline_mode}
                onChange={(e) => setConfig({ ...config, baseline_mode: e.target.value as any })}
                className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-3 py-2 text-xs text-ink focus:outline-none focus:border-gold"
              >
                <option value="centroid">Bounding Box Centroid</option>
                <option value="mean">Unweighted Geometric Mean</option>
                <option value="single_center">Single Centered Facility (K=1)</option>
              </select>
            </div>

            <FuelCard config={config} onChange={(patch) => setConfig({ ...config, ...patch })} neighborhoods={neighborhoods} />

            <TrafficCard
              config={config}
              onChange={(patch) => setConfig({ ...config, ...patch })}
              lastAvgCongestion={lastResult?.metrics.avg_congestion_pct ?? null}
              lastNote={lastResult?.traffic_note ?? null}
              neighborhoods={neighborhoods}
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Optimization Results Section */}
      {lastResult && (
        <div className="space-y-4">
          {lastResult.comparison && onGoToComparison && (
            <button
              onClick={onGoToComparison}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-cream-deep hover:bg-gold-100 text-ink rounded-full text-[13px] font-bold transition cursor-pointer"
            >
              View full cost comparison
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {/* Comparison Delta Highlights — uniform cards, no color coding */}
          {lastResult.comparison && (
            <div className="grid grid-cols-1 gap-3">
              {[
                {
                  icon: TrendingDown,
                  label: 'Distance saved',
                  value: `${lastResult.comparison.delta.pct_distance_saved}%`,
                  sub: `${lastResult.comparison.delta.weighted_distance_saved.toLocaleString()} km•orders saved`
                },
                {
                  icon: DollarSign,
                  label: 'Cost reduction',
                  value: `${lastResult.comparison.delta.pct_cost_saved}%`,
                  sub: `$${lastResult.comparison.delta.cost_saved.toLocaleString()} delivery cost savings`
                },
                {
                  icon: CheckCircle2,
                  label: 'Avg distance / order',
                  value: `${lastResult.metrics.avg_distance_per_order_km} km`,
                  sub: `Baseline was ${lastResult.comparison.baseline.metrics.avg_distance_per_order_km} km`
                }
              ].map((s) => {
                const Icon = s.icon;
                return (
                  <div key={s.label} className="card p-4 flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-cream-deep flex items-center justify-center text-ink shrink-0">
                      <Icon className="w-5 h-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                        {s.label}
                      </span>
                      <span className="block text-[22px] font-extrabold text-ink leading-tight">
                        {s.value}
                      </span>
                      <span className="block text-[11px] text-ink-faint truncate">{s.sub}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fuel economics line */}
          <div className="p-4 bg-amber-50/60 border border-amber-200/70 rounded-2xl flex items-start gap-3">
            <span className="text-lg leading-none">⛽</span>
            <div className="text-xs">
              <span className="font-bold text-slate-800">
                Fuel: ${lastResult.metrics.total_fuel_cost?.toLocaleString() ?? 0}
              </span>
              <span className="text-slate-600">
                {' '}of ${lastResult.metrics.total_cost.toLocaleString()} total
                {lastResult.metrics.fuel_live ? ' • live prices' : ' • manual rates'}
                {lastResult.fuel_note ? ` — ${lastResult.fuel_note}` : ''}
              </span>
            </div>
          </div>

          {/* Traffic economics line */}
          <div className="p-4 bg-violet-50/60 border border-violet-200/70 rounded-2xl flex items-start gap-3">
            <span className="text-lg leading-none">🚦</span>
            <div className="text-xs">
              <span className="font-bold text-slate-800">
                Traffic: +{((lastResult.metrics.avg_congestion_pct ?? 0) * 100).toFixed(0)}% avg corridor delay
              </span>
              <span className="text-slate-600">
                {lastResult.traffic_note ? ` — ${lastResult.traffic_note}` : ''}
              </span>
            </div>
          </div>

          {/* Road routing provenance line */}
          {lastResult.routing_note && (
            <div className="p-4 bg-sky-50/60 border border-sky-200/70 rounded-2xl flex items-start gap-3">
              <span className="text-lg leading-none">🛣️</span>
              <div className="text-xs">
                <span className="font-bold text-slate-800">Road distances: </span>
                <span className="text-slate-600">{lastResult.routing_note} — assignments carry per-route travel times.</span>
              </div>
            </div>
          )}

          {/* Phase C: dynamic reroute on current traffic (α·cost + β·time) */}
          {lastResult.warehouses.length > 1 && (
            <div className="p-4 bg-violet-50/60 border border-violet-200/70 rounded-2xl space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Route className="w-3.5 h-3.5 text-violet-600" />
                  Dynamic reroute (α·cost + β·time)
                </span>
                <button
                  onClick={handleReroute}
                  disabled={rerouting}
                  className="px-4 py-1.5 bg-[#14424E] hover:bg-[#0d333d] disabled:opacity-50 text-white rounded-full text-[11px] font-bold transition cursor-pointer"
                >
                  {rerouting ? 'Re-evaluating…' : 'Re-evaluate on current traffic'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Sites stay fixed — only the neighborhood→warehouse mapping moves to the
                time-and-money optimum under current corridor congestion.
              </p>
              {rerouteError && (
                <p className="text-[11px] text-rose-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {rerouteError}
                </p>
              )}
              {reroute && (
                <div className="text-xs text-slate-700 bg-white/80 border border-violet-100 rounded-xl px-3 py-2 space-y-1">
                  {reroute.changed === 0 ? (
                    <span>Current assignment is already optimal — no nodes moved.</span>
                  ) : (
                    <>
                      <span className="font-bold">
                        {reroute.changed} node{reroute.changed === 1 ? '' : 's'} moved
                      </span>
                      <span>
                        {' '}— saved ₹{reroute.saved_cost.toLocaleString()} and {reroute.saved_minutes.toLocaleString()} min
                        ({reroute.moved_neighborhood_ids.slice(0, 8).join(', ')}
                        {reroute.moved_neighborhood_ids.length > 8
                          ? ` +${reroute.moved_neighborhood_ids.length - 8} more`
                          : ''}).
                      </span>
                    </>
                  )}
                  {reroute.traffic_note && (
                    <span className="block text-[11px] text-slate-500">{reroute.traffic_note}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Infeasibility Warning if any */}
          {!lastResult.is_feasible && lastResult.infeasibility_reason && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-amber-900 text-xs">Constraint Feasibility Notice</h4>
                <p className="text-xs text-amber-800 mt-0.5">{lastResult.infeasibility_reason}</p>
              </div>
            </div>
          )}

          {/* Incremental expansion: add warehouses without removing existing ones */}
          <WarehouseExpansion neighborhoods={neighborhoods} before={lastResult} onApply={onOptimizationComplete} />

          {/* Optimized Warehouse Cards */}
          <div className="card p-5">
            <h3 className="font-bold text-sm text-ink mb-4 flex items-center gap-2">
              <span>📍 Optimized Warehouse Locations (K = {lastResult.warehouses.length})</span>
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {lastResult.warehouses.map((w) => {
                const metric = lastResult.metrics.warehouses.find(wm => wm.warehouse_id === w.warehouse_id);
                return (
                  <div key={w.warehouse_id} className="p-4 rounded-2xl border border-[#E4E1D2] bg-cream-deep">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-extrabold text-ink font-mono text-sm">{w.warehouse_id}</span>
                      <span className="text-[11px] text-ink-faint font-semibold">{metric?.neighborhood_count || 0} nodes assigned</span>
                    </div>
                    <p className="font-mono text-xs text-ink-soft">{w.latitude.toFixed(4)}°N, {w.longitude.toFixed(4)}°E</p>
                    <div className="mt-3 pt-3 border-t border-[#E4E1D2] text-xs flex justify-between items-center">
                      <span className="text-ink-faint">Daily Demand:</span>
                      <span className="font-bold font-mono text-ink">{w.assigned_orders?.toLocaleString()} orders</span>
                    </div>
                    {w.utilization_pct !== null && w.utilization_pct !== undefined && (
                      <div className="mt-1 text-xs flex justify-between items-center">
                        <span className="text-ink-faint">Utilization:</span>
                        <span className={`font-bold font-mono ${w.utilization_pct > 100 ? 'text-rose-500' : 'text-ink'}`}>
                          {w.utilization_pct}%
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sample Assignments Table Preview */}
          <div className="card p-5">
            <h3 className="font-bold text-sm text-ink mb-3">
              📋 Neighborhood Assignments Preview (Top 10 of {lastResult.assignments.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-cream-deep border-b border-[#E4E1D2] text-ink-faint font-semibold uppercase tracking-wider">
                    <th className="py-2.5 px-4">Neighborhood ID</th>
                    <th className="py-2.5 px-4">Assigned Warehouse</th>
                    <th className="py-2.5 px-4">Distance (km)</th>
                    <th className="py-2.5 px-4">Weighted Dist (km&bull;orders)</th>
                    <th className="py-2.5 px-4">Delivery Cost ($)</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lastResult.assignments.slice(0, 10).map((a) => (
                    <tr key={a.neighborhood_id} className="hover:bg-cream-deep">
                      <td className="py-2 px-4 font-mono font-medium text-ink">{a.neighborhood_id}</td>
                      <td className="py-2 px-4 font-mono font-bold text-ink">{a.warehouse_id}</td>
                      <td className="py-2 px-4 font-mono text-ink-soft">{a.distance_km} km</td>
                      <td className="py-2 px-4 font-mono text-ink-soft">{a.weighted_distance.toLocaleString()}</td>
                      <td className="py-2 px-4 font-mono text-ink font-semibold">${a.cost.toFixed(2)}</td>
                      <td className="py-2 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded-full font-semibold text-[10px] ${
                          a.is_feasible ? 'bg-grape-100 text-grape-600' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {a.is_feasible ? 'Feasible' : 'Radius Exceeded'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
