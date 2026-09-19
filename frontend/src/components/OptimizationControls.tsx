import React, { useState } from 'react';
import { Sliders, Cpu, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Info, ArrowRight } from 'lucide-react';
import { OptimizationConfig, DistanceMetric, Neighborhood } from '../types';

interface OptimizationControlsProps {
  config: OptimizationConfig;
  onChange: (updated: OptimizationConfig) => void;
  neighborhoods: Neighborhood[];
  onProceedToOptimization: () => void;
}

export const OptimizationControls: React.FC<OptimizationControlsProps> = ({
  config,
  onChange,
  neighborhoods,
  onProceedToOptimization,
}) => {
  const [showAdvancedConstraints, setShowAdvancedConstraints] = useState(false);

  const totalDemand = neighborhoods.reduce((sum, n) => sum + (Number(n.daily_orders) || 0), 0);
  const totalCapacity = (config.K || 1) * (config.C_max || 0);
  const isCapacityInfeasible = config.capacity_enabled && config.C_max != null && totalCapacity < totalDemand;

  const handleMetricChange = (metric: DistanceMetric) => {
    onChange({ ...config, distance_metric: metric });
  };

  const handleKChange = (newK: number) => {
    const validK = Math.max(1, Math.min(10, newK));
    onChange({ ...config, K: validK });
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-5">
      {/* Title & Badge */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
            ⚙️
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Optimization Parameters</h3>
            <p className="text-xs text-slate-500">Warehouse location & assignment controls</p>
          </div>
        </div>
        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
          schema.md §2.4
        </span>
      </div>

      {/* Warehouse Count K Selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <span>Number of Warehouses (K)</span>
            <span className="text-[10px] text-slate-400 font-normal">(Range: 1 – 10)</span>
          </label>
          <span className="text-xs font-extrabold font-mono px-2.5 py-0.5 rounded-lg bg-emerald-600 text-white shadow-xs">
            K = {config.K}
          </span>
        </div>

        {/* Range Slider */}
        <input
          type="range"
          min="1"
          max="10"
          step="1"
          value={config.K}
          onChange={(e) => handleKChange(parseInt(e.target.value, 10))}
          className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
        />

        {/* Quick K preset buttons */}
        <div className="flex justify-between gap-1 pt-1">
          {[1, 2, 3, 4, 5, 6, 8, 10].map((val) => (
            <button
              key={val}
              onClick={() => handleKChange(val)}
              className={`flex-1 py-1 rounded-lg text-xs font-mono font-medium transition ${
                config.K === val
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-transparent'
              }`}
            >
              {val}
            </button>
          ))}
        </div>
      </div>

      {/* Distance Metric Selection */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-800 flex items-center justify-between">
          <span>Distance Metric</span>
          <span className="text-[10px] text-slate-400 font-normal">d(n_i, w_k)</span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => handleMetricChange('haversine')}
            className={`p-2.5 rounded-xl border text-left transition ${
              config.distance_metric === 'haversine'
                ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-xs'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <div className="text-xs font-bold flex items-center justify-between">
              <span>Haversine</span>
              {config.distance_metric === 'haversine' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Great-circle (km)</div>
          </button>

          <button
            type="button"
            onClick={() => handleMetricChange('euclidean')}
            className={`p-2.5 rounded-xl border text-left transition ${
              config.distance_metric === 'euclidean'
                ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-xs'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <div className="text-xs font-bold flex items-center justify-between">
              <span>Euclidean</span>
              {config.distance_metric === 'euclidean' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">L2 plane distance</div>
          </button>

          <button
            type="button"
            onClick={() => handleMetricChange('manhattan')}
            className={`p-2.5 rounded-xl border text-left transition ${
              config.distance_metric === 'manhattan'
                ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-xs'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <div className="text-xs font-bold flex items-center justify-between">
              <span>Manhattan</span>
              {config.distance_metric === 'manhattan' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">L1 grid distance</div>
          </button>
        </div>
        <p className="text-[11px] text-slate-500 italic">
          {config.distance_metric === 'haversine' && '✓ Accurate spherical earth distance accounting for earth curvature.'}
          {config.distance_metric === 'euclidean' && 'Straight-line flat coordinate distance (geometric centroid baseline).'}
          {config.distance_metric === 'manhattan' && 'Grid/city-block distance |Δlat| + |Δlon| in km.'}
        </p>
      </div>

      {/* Constraints Accordion Toggle */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvancedConstraints(!showAdvancedConstraints)}
          className="w-full px-4 py-3 bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
        >
          <span className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            Advanced Constraints & Bonus Parameters
          </span>
          {showAdvancedConstraints ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showAdvancedConstraints && (
          <div className="p-4 space-y-4 bg-white">
            {/* Warehouse Capacity C_max */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.capacity_enabled}
                    onChange={(e) => onChange({ ...config, capacity_enabled: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Warehouse Capacity (C_max)</span>
                </label>
                {config.capacity_enabled && (
                  <span className="text-[10px] text-slate-400">Total: {totalCapacity.toLocaleString()}</span>
                )}
              </div>

              {config.capacity_enabled && (
                <div className="pl-6 space-y-1">
                  <input
                    type="number"
                    min="1"
                    value={config.C_max || ''}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        C_max: e.target.value ? parseInt(e.target.value, 10) : null,
                      })
                    }
                    placeholder="Max orders per warehouse (e.g. 1500)"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  {isCapacityInfeasible && (
                    <div className="flex items-center gap-1.5 text-[11px] text-rose-600">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      <span>
                        Total capacity ({totalCapacity}) is less than total demand ({totalDemand}).
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Service Radius R_max */}
            <div className="space-y-1.5 border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.radius_enabled}
                    onChange={(e) => onChange({ ...config, radius_enabled: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Max Delivery Radius (R_max)</span>
                </label>
              </div>

              {config.radius_enabled && (
                <div className="pl-6">
                  <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    value={config.R_max_km || ''}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        R_max_km: e.target.value ? parseFloat(e.target.value) : null,
                      })
                    }
                    placeholder="Max radius in km (e.g. 15.0)"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Cost Rates */}
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Cost / km ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={config.cost_per_km}
                  onChange={(e) => onChange({ ...config, cost_per_km: parseFloat(e.target.value) || 0 })}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Traffic Delay Factor</label>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.traffic_factor}
                  onChange={(e) => onChange({ ...config, traffic_factor: parseFloat(e.target.value) || 0 })}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs"
                  placeholder="0.0 - 1.0"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Proceed to Phase 3 Action */}
      <button
        type="button"
        onClick={onProceedToOptimization}
        className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white rounded-2xl text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center justify-center space-x-2 transition cursor-pointer"
      >
        <Cpu className="w-4 h-4" />
        <span>Ready: Optimize Warehouse Placement (K={config.K})</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
