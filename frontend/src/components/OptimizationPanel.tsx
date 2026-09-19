import React, { useState } from 'react';
import { Cpu, CheckCircle2, AlertTriangle, Zap, TrendingDown, DollarSign } from 'lucide-react';
import { Neighborhood, OptimizationConfig, OptimizationResult } from '../types';
import { optimizeNetwork } from '../services/api';

interface OptimizationPanelProps {
  neighborhoods: Neighborhood[];
  onOptimizationComplete: (result: OptimizationResult) => void;
  lastResult: OptimizationResult | null;
}

export const OptimizationPanel: React.FC<OptimizationPanelProps> = ({
  neighborhoods,
  onOptimizationComplete,
  lastResult
}) => {
  const [config, setConfig] = useState<OptimizationConfig>({
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
    random_seed: 42,
    baseline_mode: 'centroid'
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalDemand = neighborhoods.reduce((sum, n) => sum + (Number(n.daily_orders) || 0), 0);

  const handleRunOptimization = async () => {
    if (neighborhoods.length === 0) {
      setError('Please load or create neighborhoods first before running optimization.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await optimizeNetwork(neighborhoods, config);
      onOptimizationComplete(result);
    } catch (err: any) {
      setError(err.message || 'Optimization failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Control Configuration Card */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-emerald-600" />
              Optimization Engine (Phase 3 &bull; schema.md §2.4)
            </h2>
            <p className="text-xs text-slate-500">
              Weiszfeld geometric median (K=1), Weighted K-Means (K&gt;1), and PuLP CFLP solver
            </p>
          </div>

          <button
            onClick={handleRunOptimization}
            disabled={loading || neighborhoods.length === 0}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-2xl text-xs font-bold shadow-md shadow-emerald-600/20 transition cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            <span>{loading ? 'Optimizing Network...' : 'Run Warehouse Optimization'}</span>
          </button>
        </div>

        {/* Parameters Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-5 text-xs">
          {/* Column 1: K & Metric */}
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-slate-700">Number of Warehouses (K)</span>
                <span className="font-mono text-emerald-700 font-bold text-sm">{config.K}</span>
              </div>
              <input
                type="range"
                min="1"
                max={Math.min(10, Math.max(1, neighborhoods.length))}
                value={config.K}
                onChange={(e) => setConfig({ ...config, K: parseInt(e.target.value) })}
                className="w-full accent-emerald-600 cursor-pointer"
              />
              <span className="text-[11px] text-slate-400">
                {config.K === 1 ? 'K=1: Solves weighted geometric median (Weiszfeld)' : 'K>1: Weighted K-Means + cluster medians'}
              </span>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Distance Metric</label>
              <select
                value={config.distance_metric}
                onChange={(e) => setConfig({ ...config, distance_metric: e.target.value as any })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500"
              >
                <option value="haversine">Haversine (Great-Circle / Spherical)</option>
                <option value="euclidean">Euclidean (Planar Equirectangular)</option>
                <option value="manhattan">Manhattan (Grid / City-Block Routing)</option>
              </select>
            </div>
          </div>

          {/* Column 2: Capacity & Radius Constraints */}
          <div className="space-y-3 bg-slate-50/70 p-4 rounded-2xl border border-slate-100">
            <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] block">
              Operational Constraints (CFLP)
            </span>

            {/* Capacity Toggle */}
            <div>
              <label className="flex items-center space-x-2 cursor-pointer mb-1.5">
                <input
                  type="checkbox"
                  checked={config.capacity_enabled}
                  onChange={(e) => setConfig({ ...config, capacity_enabled: e.target.checked })}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span className="font-medium text-slate-700">Enforce Warehouse Capacity (C_max)</span>
              </label>
              {config.capacity_enabled && (
                <div className="pl-5 space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="10"
                      value={config.C_max || 500}
                      onChange={(e) => setConfig({ ...config, C_max: parseInt(e.target.value) || 100 })}
                      className="w-24 bg-white border border-slate-200 rounded-lg px-2 py-1 font-mono text-xs"
                    />
                    <span className="text-[11px] text-slate-500">orders / warehouse</span>
                  </div>
                  <p className="text-[10px] text-slate-400">Total capacity: {config.K * (config.C_max || 0)} orders (Demand: {totalDemand})</p>
                </div>
              )}
            </div>

            {/* Radius Toggle */}
            <div>
              <label className="flex items-center space-x-2 cursor-pointer mb-1.5">
                <input
                  type="checkbox"
                  checked={config.radius_enabled}
                  onChange={(e) => setConfig({ ...config, radius_enabled: e.target.checked })}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span className="font-medium text-slate-700">Max Service Radius (R_max)</span>
              </label>
              {config.radius_enabled && (
                <div className="pl-5 flex items-center gap-2">
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={config.R_max_km || 15.0}
                    onChange={(e) => setConfig({ ...config, R_max_km: parseFloat(e.target.value) || 10.0 })}
                    className="w-24 bg-white border border-slate-200 rounded-lg px-2 py-1 font-mono text-xs"
                  />
                  <span className="text-[11px] text-slate-500">km max delivery radius</span>
                </div>
              )}
            </div>
          </div>

          {/* Column 3: Cost & Baseline */}
          <div className="space-y-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Delivery Cost Rate ($/km&bull;order)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={config.cost_per_km}
                onChange={(e) => setConfig({ ...config, cost_per_km: parseFloat(e.target.value) || 1.0 })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Baseline Comparison Mode</label>
              <select
                value={config.baseline_mode}
                onChange={(e) => setConfig({ ...config, baseline_mode: e.target.value as any })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500"
              >
                <option value="centroid">Bounding Box Centroid</option>
                <option value="mean">Unweighted Geometric Mean</option>
                <option value="single_center">Single Centered Facility (K=1)</option>
              </select>
            </div>
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
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Comparison Delta Highlights */}
          {lastResult.comparison && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/80 p-5 rounded-3xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Distance Saved</span>
                  <TrendingDown className="w-5 h-5 text-emerald-600" />
                </div>
                <h4 className="text-3xl font-extrabold text-emerald-900 mt-2">
                  {lastResult.comparison.delta.pct_distance_saved}%
                </h4>
                <p className="text-xs text-emerald-700 mt-1">
                  {lastResult.comparison.delta.weighted_distance_saved.toLocaleString()} km&bull;orders saved
                </p>
              </div>

              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/80 p-5 rounded-3xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">Cost Reduction</span>
                  <DollarSign className="w-5 h-5 text-blue-600" />
                </div>
                <h4 className="text-3xl font-extrabold text-blue-900 mt-2">
                  {lastResult.comparison.delta.pct_cost_saved}%
                </h4>
                <p className="text-xs text-blue-700 mt-1">
                  ${lastResult.comparison.delta.cost_saved.toLocaleString()} delivery cost savings
                </p>
              </div>

              <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/80 p-5 rounded-3xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-800 uppercase tracking-wider">Avg Distance / Order</span>
                  <CheckCircle2 className="w-5 h-5 text-purple-600" />
                </div>
                <h4 className="text-3xl font-extrabold text-purple-900 mt-2">
                  {lastResult.metrics.avg_distance_per_order_km} km
                </h4>
                <p className="text-xs text-purple-700 mt-1">
                  Baseline was {lastResult.comparison.baseline.metrics.avg_distance_per_order_km} km
                </p>
              </div>
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

          {/* Optimized Warehouse Cards */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 mb-4 flex items-center gap-2">
              <span>📍 Optimized Warehouse Locations (K = {lastResult.warehouses.length})</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {lastResult.warehouses.map((w) => {
                const metric = lastResult.metrics.warehouses.find(wm => wm.warehouse_id === w.warehouse_id);
                return (
                  <div key={w.warehouse_id} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-extrabold text-emerald-700 font-mono text-sm">{w.warehouse_id}</span>
                      <span className="text-[11px] text-slate-500 font-semibold">{metric?.neighborhood_count || 0} nodes assigned</span>
                    </div>
                    <p className="font-mono text-xs text-slate-600">{w.latitude.toFixed(4)}°N, {w.longitude.toFixed(4)}°E</p>
                    <div className="mt-3 pt-3 border-t border-slate-200/60 text-xs flex justify-between items-center">
                      <span className="text-slate-500">Daily Demand:</span>
                      <span className="font-bold font-mono text-slate-800">{w.assigned_orders?.toLocaleString()} orders</span>
                    </div>
                    {w.utilization_pct !== null && w.utilization_pct !== undefined && (
                      <div className="mt-1 text-xs flex justify-between items-center">
                        <span className="text-slate-500">Utilization:</span>
                        <span className={`font-bold font-mono ${w.utilization_pct > 100 ? 'text-rose-600' : 'text-emerald-700'}`}>
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
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 mb-3">
              📋 Neighborhood Assignments Preview (Top 10 of {lastResult.assignments.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
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
                    <tr key={a.neighborhood_id} className="hover:bg-slate-50/70">
                      <td className="py-2 px-4 font-mono font-medium text-slate-900">{a.neighborhood_id}</td>
                      <td className="py-2 px-4 font-mono font-bold text-emerald-700">{a.warehouse_id}</td>
                      <td className="py-2 px-4 font-mono text-slate-600">{a.distance_km} km</td>
                      <td className="py-2 px-4 font-mono text-slate-600">{a.weighted_distance.toLocaleString()}</td>
                      <td className="py-2 px-4 font-mono text-slate-900 font-semibold">${a.cost.toFixed(2)}</td>
                      <td className="py-2 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded-full font-semibold text-[10px] ${
                          a.is_feasible ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
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
