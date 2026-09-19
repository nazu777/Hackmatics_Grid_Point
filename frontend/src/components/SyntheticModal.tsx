import React, { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { SyntheticConfig, Neighborhood } from '../types';
import { fetchSynthetic } from '../services/api';

interface SyntheticModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (nodes: Neighborhood[]) => void;
  onOpenCensus?: () => void;
}

const CITY_PRESETS = [
  { name: 'Hyderabad', lat: 17.385044, lon: 78.486671 },
  { name: 'Bengaluru', lat: 12.971598, lon: 77.594566 },
  { name: 'Mumbai', lat: 19.076090, lon: 72.877426 },
  { name: 'Delhi NCR', lat: 28.613939, lon: 77.209023 }
];

export const SyntheticModal: React.FC<SyntheticModalProps> = ({ isOpen, onClose, onGenerated, onOpenCensus }) => {
  const [config, setConfig] = useState<SyntheticConfig>({
    N: 35,
    lat_center: 17.385044,
    lon_center: 78.486671,
    spread_km: 20.0,
    distribution: 'clustered',
    num_clusters: 3,
    orders_min: 20,
    orders_max: 250,
    seed: 42
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePreset = (preset: typeof CITY_PRESETS[0]) => {
    setConfig((prev) => ({
      ...prev,
      lat_center: preset.lat,
      lon_center: preset.lon
    }));
  };

  const handleGenerate = async () => {
    if (config.orders_min > config.orders_max) {
      setError("Minimum orders cannot exceed maximum orders!");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSynthetic(config);
      onGenerated(data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl border border-[#E4E1D2] shadow-2xl max-w-xl w-full p-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-[#E4E1D2] mb-5">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-cream-deep text-[#14424E] flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">Synthetic Dataset Generator</h3>
              <p className="text-xs text-ink-faint">Seedable geographic demand model</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-ink-faint hover:text-ink hover:bg-cream-deep transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Presets */}
        <div className="mb-5">
          <label className="text-xs font-semibold text-ink-soft block mb-2">City Preset Center</label>
          <div className="grid grid-cols-4 gap-2">
            {CITY_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handlePreset(p)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition text-center cursor-pointer ${
                  Math.abs(config.lat_center - p.lat) < 0.001
                    ? 'border-[#14424E] bg-grape-100 text-grape-600 font-semibold'
                    : 'border-[#E4E1D2] text-ink-soft hover:bg-cream-deep'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Form Controls */}
        <div className="space-y-4 text-xs">
          {/* Node Count & Distribution */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-ink-soft">Nodes Count (N)</span>
                <span className="font-mono text-[#14424E] font-bold">{config.N}</span>
              </div>
              <input
                type="range"
                min="5"
                max="500"
                step="5"
                value={config.N}
                onChange={(e) => setConfig({ ...config, N: parseInt(e.target.value) })}
                className="w-full accent-[#14424E]"
              />
            </div>

            <div>
              <label className="font-semibold text-ink-soft block mb-1">Distribution</label>
              <select
                value={config.distribution}
                onChange={(e) => setConfig({ ...config, distribution: e.target.value as any })}
                className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-gold"
              >
                <option value="clustered">City Mix (core + districts + hubs + fringe)</option>
                <option value="uniform">Uniform (even sprawl, full spread)</option>
                <option value="gaussian">Gaussian (Dense Core)</option>
              </select>
            </div>
          </div>

          {/* Clusters & Spread */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-ink-soft">Clusters Count</span>
                <span className="font-mono text-ink-soft">{config.distribution === 'clustered' ? config.num_clusters : 'N/A'}</span>
              </div>
              <input
                type="range"
                min="1"
                max="8"
                disabled={config.distribution !== 'clustered'}
                value={config.num_clusters}
                onChange={(e) => setConfig({ ...config, num_clusters: parseInt(e.target.value) })}
                className="w-full accent-[#14424E] disabled:opacity-40"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-ink-soft">Spread Radius</span>
                <span className="font-mono text-ink-soft">{config.spread_km} km</span>
              </div>
              <input
                type="range"
                min="5"
                max="80"
                step="2.5"
                value={config.spread_km}
                onChange={(e) => setConfig({ ...config, spread_km: parseFloat(e.target.value) })}
                className="w-full accent-[#14424E]"
              />
            </div>
          </div>

          {/* Orders Range & Seed */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-semibold text-ink-soft block mb-1">Min Daily Orders</label>
              <input
                type="number"
                min="0"
                value={config.orders_min}
                onChange={(e) => setConfig({ ...config, orders_min: parseInt(e.target.value) || 0 })}
                className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2.5 py-1.5 font-mono focus:outline-none focus:border-gold"
              />
            </div>
            <div>
              <label className="font-semibold text-ink-soft block mb-1">Max Daily Orders</label>
              <input
                type="number"
                min="1"
                value={config.orders_max}
                onChange={(e) => setConfig({ ...config, orders_max: parseInt(e.target.value) || 100 })}
                className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2.5 py-1.5 font-mono focus:outline-none focus:border-gold"
              />
            </div>
            <div>
              <label className="font-semibold text-ink-soft block mb-1">Random Seed</label>
              <input
                type="number"
                value={config.seed}
                onChange={(e) => setConfig({ ...config, seed: parseInt(e.target.value) || 42 })}
                className="w-full bg-cream-deep border border-[#E4E1D2] rounded-xl px-2.5 py-1.5 font-mono focus:outline-none focus:border-gold"
              />
            </div>
          </div>

          {error && (
            <p className="text-rose-600 font-medium">{error}</p>
          )}
        </div>

        {/* Real-data shortcut */}
        {onOpenCensus && (
          <button
            onClick={() => {
              onClose();
              onOpenCensus();
            }}
            className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-bold transition cursor-pointer"
          >
            <span>🗽</span>
            <span>Prefer real data? Seed a US city (NYC, LA, Chicago…) from live Census tracts</span>
          </button>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-[#E4E1D2] flex items-center justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-ink-soft hover:bg-cream-deep rounded-full transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-[#14424E] hover:bg-[#0d333d] rounded-full transition cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{loading ? "Generating..." : "Generate Dataset"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
