import React, { useEffect, useState } from 'react';
import { X, Flag, Wifi, WifiOff } from 'lucide-react';
import { Neighborhood, type CensusCity } from '../types';
import { fetchCensusCities, fetchCensusDemand } from '../services/api';

interface CensusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (nodes: Neighborhood[]) => void;
}

export const CensusModal: React.FC<CensusModalProps> = ({ isOpen, onClose, onGenerated }) => {
  const [cities, setCities] = useState<CensusCity[]>([]);
  const [cityId, setCityId] = useState('los-angeles');
  const [ordersPer1000, setOrdersPer1000] = useState(5);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetchCensusCities()
      .then((res) => {
        setCities(res.cities);
        setKeyConfigured(res.key_configured);
      })
      .catch(() => setError('Census service unreachable.'));
  }, [isOpen]);

  if (!isOpen) return null;

  const selected = cities.find((c) => c.city_id === cityId);

  const handleSeed = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCensusDemand(cityId, ordersPer1000);
      onGenerated(data.neighborhoods);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Seeding failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-xl w-full p-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
              <Flag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">Seed US City — Real Census Demand</h3>
              <p className="text-xs text-slate-500">ACS tract populations × orders rate → warehouse-ready demand</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4 flex items-center gap-2 text-xs">
          {keyConfigured ? (
            <span className="flex items-center gap-1 text-emerald-700 font-semibold">
              <Wifi className="w-3.5 h-3.5" /> Census API key active — full tract detail
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-700 font-semibold">
              <WifiOff className="w-3.5 h-3.5" /> Keyless mode — standard Census quota applies
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
          {cities.map((c) => (
            <button
              key={c.city_id}
              type="button"
              onClick={() => setCityId(c.city_id)}
              className={`px-3 py-2 rounded-xl text-xs font-medium border transition text-center cursor-pointer ${
                cityId === c.city_id
                  ? 'border-blue-500 bg-blue-50 text-blue-800 font-semibold'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="block font-bold">{c.label}</span>
              <span className="block text-[10px] text-slate-400 mt-0.5">{c.counties.join(' • ')}</span>
            </button>
          ))}
        </div>

        <div className="mb-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-semibold text-slate-700">Daily orders per 1,000 residents</span>
            <span className="font-mono text-blue-700 font-bold text-xs">{ordersPer1000}</span>
          </div>
          <input
            type="range"
            min="1"
            max="50"
            step="1"
            value={ordersPer1000}
            onChange={(e) => setOrdersPer1000(Number(e.target.value))}
            className="w-full accent-blue-600"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            {selected ? `${selected.label} loads every census tract as a demand node (population × rate).` : ''}
            Tract counts run into the hundreds — the map, optimizer and cost engine handle them natively.
          </p>
        </div>

        {error && <p className="text-rose-600 font-medium text-xs mt-2">{error}</p>}

        <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSeed}
            disabled={loading}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-xl shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            <Flag className="w-3.5 h-3.5" />
            <span>{loading ? 'Loading tracts…' : 'Seed City Demand'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
