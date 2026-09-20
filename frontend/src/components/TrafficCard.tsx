import React, { useEffect, useState } from 'react';
import { Siren, Wifi, WifiOff } from 'lucide-react';
import type { OptimizationConfig } from '../types';

interface TrafficCardProps {
  config: OptimizationConfig;
  onChange: (patch: Partial<OptimizationConfig>) => void;
  /** Corridor readout from the last run (avg congestion + note). */
  lastAvgCongestion?: number | null;
  lastNote?: string | null;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Live traffic card for the optimizer (Stage: warehouse setup).
 * Toggle pulls real-time TomTom corridor speeds (server key, 5-min cache);
 * every reading is recorded into rolling history that steers the next
 * optimization's placement (MILP) and evaluation. History works keyless.
 *
 * Phase C: "Optimize on current traffic" (use_live_traffic_for_routing)
 * samples live speeds along the assigned road corridors so matrices +
 * assignment react to current conditions; "Dynamic reroute"
 * (traffic_aware_reroute) refines assignment for α·cost + β·time.
 */
export const TrafficCard: React.FC<TrafficCardProps> = ({ config, onChange, lastAvgCongestion, lastNote }) => {
  const [nowHour, setNowHour] = useState<number>(new Date().getHours());
  useEffect(() => {
    const t = setInterval(() => setNowHour(new Date().getHours()), 60000);
    return () => clearInterval(t);
  }, []);

  const effectiveHour = config.traffic_hour ?? nowHour;

  return (
    <div className="bg-violet-50/60 p-4 rounded-2xl border border-violet-100 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
          <Siren className="w-3.5 h-3.5 text-violet-600" /> Live Traffic
        </span>
        <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={!!config.use_live_traffic}
            onChange={(e) => onChange({ use_live_traffic: e.target.checked })}
            className="rounded text-emerald-600 focus:ring-emerald-500"
          />
          <span>Real-time speeds</span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="font-semibold text-slate-700 block mb-1 text-xs">Manual floor (+%)</label>
          <input
            type="number"
            step="5"
            min="0"
            max="200"
            value={Math.round((config.traffic_factor || 0) * 100)}
            onChange={(e) => onChange({ traffic_factor: Math.max(0, Number(e.target.value) || 0) / 100 })}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 font-mono text-xs"
          />
        </div>
        <div>
          <label className="font-semibold text-slate-700 block mb-1 text-xs">History hour</label>
          <select
            value={config.traffic_hour ?? ''}
            onChange={(e) => onChange({ traffic_hour: e.target.value === '' ? null : Number(e.target.value) })}
            className="w-full bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-xs"
          >
            <option value="">Now ({nowHour}:00)</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Phase C: optimize-on-traffic + dynamic reroute toggles */}
      <label className="flex items-start gap-2 cursor-pointer text-[11px] text-slate-700 bg-white/70 border border-violet-100 rounded-xl px-2.5 py-2">
        <input
          type="checkbox"
          checked={!!config.use_live_traffic_for_routing}
          onChange={(e) => onChange({ use_live_traffic_for_routing: e.target.checked })}
          className="rounded text-violet-600 focus:ring-violet-500 mt-0.5"
        />
        <span>
          <span className="font-bold">Optimize on current traffic</span>
          <span className="block text-slate-500">Corridor speeds from road geometries feed matrices + assignment.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer text-[11px] text-slate-700 bg-white/70 border border-violet-100 rounded-xl px-2.5 py-2">
        <input
          type="checkbox"
          checked={!!config.traffic_aware_reroute}
          onChange={(e) => onChange({ traffic_aware_reroute: e.target.checked })}
          className="rounded text-violet-600 focus:ring-violet-500 mt-0.5"
        />
        <span>
          <span className="font-bold">Dynamic reroute (α·cost + β·time)</span>
          <span className="block text-slate-500">Re-evaluates assignment as corridors change; reports moved nodes + saved min/₹.</span>
        </span>
      </label>

      {lastAvgCongestion != null && lastAvgCongestion > 0 ? (
        <p className="text-[11px] text-slate-600 flex items-center gap-1">
          <Wifi className="w-3 h-3 text-emerald-600" />
          <span>
            Corridors averaging +{(lastAvgCongestion * 100).toFixed(0)}% (hour {effectiveHour}:00)
            {lastNote ? ` — ${lastNote}` : ''}
          </span>
        </p>
      ) : (
        <p className="text-[10px] text-slate-500 flex items-center gap-1">
          <WifiOff className="w-3 h-3 text-slate-400" />
          <span>
            Past corridor congestion steers placement (MILP) and evaluation. No history for this hour yet — enable
            real-time speeds to start recording.
          </span>
        </p>
      )}
    </div>
  );
};
