import React, { useEffect, useState } from 'react';
import { Fuel, Wifi, WifiOff, MapPin } from 'lucide-react';
import type { FuelRates, Neighborhood, OptimizationConfig } from '../types';
import { fetchFuelRates, fuelPriceFor } from '../services/api';
import { datasetCenter, nearestPricedCity } from './panelStore';

interface FuelCardProps {
  config: OptimizationConfig;
  onChange: (patch: Partial<OptimizationConfig>) => void;
  neighborhoods: Neighborhood[];
}

/**
 * Live fuel price card for the optimizer (Stage: warehouse setup).
 * Toggle pulls daily RapidAPI ₹/litre rates (server key, 12h cache); the
 * price city is auto-derived from the dataset center — never asked.
 * Without a key or offline it badges static fallbacks.
 */
export const FuelCard: React.FC<FuelCardProps> = ({ config, onChange, neighborhoods }) => {
  const [rates, setRates] = useState<FuelRates | null>(null);
  const [loading, setLoading] = useState(false);
  const state = config.fuel_state || 'Karnataka';

  useEffect(() => {
    let cancelled = false;
    if (!config.use_live_fuel) {
      setRates(null);
      return;
    }
    setLoading(true);
    fetchFuelRates(state)
      .then((r) => {
        if (!cancelled) setRates(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config.use_live_fuel, state]);

  const cities = rates?.cities ?? [];
  // Auto city: nearest priced city to the dataset center (no user prompt).
  const autoCity = datasetCenter(neighborhoods)
    ? nearestPricedCity(datasetCenter(neighborhoods), cities)
    : null;
  const city = config.fuel_city || autoCity || cities[0]?.city || null;

  // Pin the auto-derived city into config once rates arrive so the backend
  // prices the exact same city the card displays.
  useEffect(() => {
    if (config.use_live_fuel && !config.fuel_city && autoCity) {
      onChange({ fuel_city: autoCity });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.use_live_fuel, autoCity]);

  const petrol = rates ? fuelPriceFor(rates, 'petrol', city) : null;
  const diesel = rates ? fuelPriceFor(rates, 'diesel', city) : null;
  const cng = rates ? fuelPriceFor(rates, 'cng', city) : null;

  return (
    <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-100 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
          <Fuel className="w-3.5 h-3.5 text-amber-600" /> Fuel Prices (₹/L)
        </span>
        <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={!!config.use_live_fuel}
            onChange={(e) => onChange({ use_live_fuel: e.target.checked })}
            className="rounded text-emerald-600 focus:ring-emerald-500"
          />
          <span>Live rates</span>
        </label>
      </div>

      {config.use_live_fuel ? (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={state}
              onChange={(e) => onChange({ fuel_state: e.target.value || 'Karnataka', fuel_city: null })}
              placeholder="State (e.g. Karnataka)"
              className="w-1/2 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs"
            />
            <span className="w-1/2 flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700">
              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="truncate">Auto: {city || 'nearest city…'}</span>
            </span>
          </div>

          {loading ? (
            <p className="text-[11px] text-slate-500">Fetching daily rates…</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Petrol', v: petrol },
                { label: 'Diesel', v: diesel },
                { label: 'CNG', v: cng }
              ].map(({ label, v }) => (
                <div key={label} className="bg-white rounded-xl border border-slate-200 px-1 py-1.5">
                  <div className="text-[10px] text-slate-500 font-semibold">{label}</div>
                  <div className="font-mono text-xs font-bold text-slate-800">
                    ₹{v ? v.price.toFixed(2) : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-slate-500 flex items-center gap-1">
            {rates?.live ? (
              <>
                <Wifi className="w-3 h-3 text-emerald-600" />
                <span>Live {rates.state}{city ? ` • ${city}` : ''} rates feed the fuel-burn cost (price ÷ mileage + surcharge).</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-amber-600" />
                <span>Live feed unreachable — using static fallback rates.</span>
              </>
            )}
          </p>
        </div>
      ) : (
        <div>
          <label className="font-semibold text-slate-700 block mb-1 text-xs">Manual fuel surcharge (₹/km·order)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={config.fuel_cost_per_km}
            onChange={(e) => onChange({ fuel_cost_per_km: parseFloat(e.target.value) || 0 })}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 font-mono text-xs"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Enable live rates to price fuel burn from real ₹/L by vehicle mileage instead.
          </p>
        </div>
      )}
    </div>
  );
};
