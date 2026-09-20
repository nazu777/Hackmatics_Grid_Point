import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Download, Search, AlertCircle, ChevronLeft, ChevronRight, Sparkles, Star } from 'lucide-react';
import { VehicleType, ValidationErrorItem } from '../types';
import { fetchSyntheticVehicles } from '../services/api';
import { isBookmarked, toggleBookmark } from './panelStore';

interface VehicleTableProps {
  vehicles: VehicleType[];
  errors: ValidationErrorItem[];
  onChange: (updated: VehicleType[]) => void;
  externalQuery?: string;
}

const FUEL_OPTIONS = ['petrol', 'diesel', 'cng', 'autogas', 'electric'];

export const VehicleTable: React.FC<VehicleTableProps> = ({ vehicles, errors, onChange, externalQuery = '' }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [seeding, setSeeding] = useState(false);
  // Phase H: star toggles are self-contained — a version bump re-renders.
  const [bookmarkTick, setBookmarkTick] = useState(0);
  const rowsPerPage = 15;

  const errorMap = useMemo(() => {
    const map = new Map<number, ValidationErrorItem[]>();
    errors.forEach((err) => {
      if (err.row != null) {
        const existing = map.get(err.row) || [];
        existing.push(err);
        map.set(err.row, existing);
      }
    });
    return map;
  }, [errors]);

  const filtered = useMemo(() => {
    const terms = [externalQuery, searchTerm].map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (terms.length === 0) return vehicles;
    return vehicles.filter((v) =>
      terms.every(
        (term) =>
          v.vehicle_type.toLowerCase().includes(term) ||
          (v.fuel_type || '').toLowerCase().includes(term)
      )
    );
  }, [vehicles, searchTerm, externalQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const pageIndex = Math.min(currentPage, totalPages);
  const paginatedRows = filtered.slice((pageIndex - 1) * rowsPerPage, pageIndex * rowsPerPage);

  const handleCellChange = (actualIndex: number, field: keyof VehicleType, value: any) => {
    const updated = [...vehicles];
    let parsed: any = value;
    if (field === 'capacity') parsed = value === '' ? '' : (isNaN(parseInt(value, 10)) ? value : parseInt(value, 10));
    else if (field === 'cost_per_km' || field === 'avg_speed_kmph' || field === 'mileage_kmpl')
      parsed = value === '' ? null : (isNaN(parseFloat(value)) ? value : parseFloat(value));
    (updated[actualIndex] as any) = { ...updated[actualIndex], [field]: parsed };
    onChange(updated);
  };

  const handleAddRow = () => {
    const n = vehicles.length + 1;
    const row: VehicleType = {
      vehicle_type: `van_${n}`,
      capacity: 100,
      cost_per_km: 10.0,
      fuel_type: 'diesel',
      avg_speed_kmph: 35,
      mileage_kmpl: 12
    };
    onChange([...vehicles, row]);
    setCurrentPage(Math.ceil((vehicles.length + 1) / rowsPerPage));
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const seed = await fetchSyntheticVehicles(42, 4);
      onChange(seed);
    } finally {
      setSeeding(false);
    }
  };

  const handleExport = () => {
    const header = 'vehicle_type,capacity,cost_per_km,fuel_type,avg_speed_kmph,mileage_kmpl';
    const rows = vehicles.map((v) =>
      [v.vehicle_type, v.capacity, v.cost_per_km, v.fuel_type || 'petrol', v.avg_speed_kmph ?? 30, v.mileage_kmpl ?? ''].join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gridpoint_vehicles.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E4E1D2] shadow-sm overflow-hidden">
      <div className="p-3 border-b border-[#E4E1D2] flex flex-col items-stretch gap-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-ink-faint absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search vehicles by type or fuel..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-cream-deep border border-[#E4E1D2] rounded-full focus:outline-none focus:border-gold"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-faint font-medium">
            Showing {filtered.length} of {vehicles.length} vehicles
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={handleSeed} disabled={seeding}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-semibold transition cursor-pointer disabled:opacity-50">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{seeding ? 'Seeding...' : 'Seed demo fleet (seed=42)'}</span>
            </button>
            <button onClick={handleAddRow}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-grape-100 text-grape-600 hover:bg-grape-200 rounded-full text-xs font-semibold transition cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
              <span>Add Vehicle</span>
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cream-deep hover:bg-gold-100 text-ink rounded-full text-xs font-semibold transition cursor-pointer">
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-cream-deep border-b border-[#E4E1D2] text-ink-faint font-semibold uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">#</th>
              <th className="py-3 px-2 w-10 text-center" title="Bookmark vehicle for quick access (Saved)">★</th>
              <th className="py-3 px-4">Vehicle Type (unique)</th>
              <th className="py-3 px-4 w-28">Capacity</th>
              <th className="py-3 px-4 w-28">Cost/km</th>
              <th className="py-3 px-4 w-32">Fuel Type</th>
              <th className="py-3 px-4 w-28">Speed km/h</th>
              <th className="py-3 px-4 w-28">Mileage km/l</th>
              <th className="py-3 px-4 w-16 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-ink-faint">
                  No vehicles yet — add rows manually, upload a CSV/JSON, or seed the demo fleet.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => {
                const actualIndex = vehicles.indexOf(row);
                const rowNum = actualIndex + 1;
                const rowErrors = errorMap.get(rowNum) || [];
                const hasError = rowErrors.length > 0;
                void bookmarkTick;
                const starred = isBookmarked('vehicle', row.vehicle_type);
                return (
                  <tr key={row.vehicle_type || actualIndex} className={`hover:bg-cream-deep transition-colors ${hasError ? 'bg-rose-50/40' : ''}`}>
                    <td className="py-2.5 px-4 text-center font-mono text-ink-faint">
                      {hasError ? (
                        <span title={rowErrors.map((e) => `[${e.code}] ${e.field}: ${e.error}`).join('\n')}>
                          <AlertCircle className="w-4 h-4 text-rose-500 inline" />
                        </span>
                      ) : rowNum}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <button
                        onClick={() => {
                          toggleBookmark('vehicle', row.vehicle_type);
                          setBookmarkTick((t) => t + 1);
                        }}
                        title={starred ? 'Remove bookmark' : 'Bookmark this vehicle'}
                        className={`transition cursor-pointer ${starred ? 'text-amber-500' : 'text-ink-faint hover:text-amber-500'}`}
                      >
                        <Star className="w-4 h-4" fill={starred ? 'currentColor' : 'none'} />
                      </button>
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="text" value={row.vehicle_type}
                        onChange={(e) => handleCellChange(actualIndex, 'vehicle_type', e.target.value)}
                        className="w-full bg-transparent font-mono font-medium text-ink focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="number" min="1" step="1" value={row.capacity as any}
                        onChange={(e) => handleCellChange(actualIndex, 'capacity', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="number" min="0" step="0.1" value={row.cost_per_km as any}
                        onChange={(e) => handleCellChange(actualIndex, 'cost_per_km', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4">
                      <select value={row.fuel_type || 'petrol'}
                        onChange={(e) => handleCellChange(actualIndex, 'fuel_type', e.target.value)}
                        className="w-full bg-transparent text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5">
                        {FUEL_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="number" min="1" step="0.5" value={row.avg_speed_kmph as any ?? ''}
                        onChange={(e) => handleCellChange(actualIndex, 'avg_speed_kmph', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="number" min="0.1" step="0.1" value={(row.mileage_kmpl as any) ?? ''}
                        onChange={(e) => handleCellChange(actualIndex, 'mileage_kmpl', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <button onClick={() => onChange(vehicles.filter((_, i) => i !== actualIndex))}
                        title="Delete vehicle" className="text-ink-faint hover:text-rose-600 transition p-1 cursor-pointer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="p-3 border-t border-[#E4E1D2] flex items-center justify-between text-xs text-ink-faint">
        <div>Page {pageIndex} of {totalPages}</div>
        <div className="flex items-center space-x-1">
          <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={pageIndex === 1}
            className="p-1.5 rounded-lg border border-[#E4E1D2] disabled:opacity-40 hover:bg-cream-deep transition">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={pageIndex === totalPages}
            className="p-1.5 rounded-lg border border-[#E4E1D2] disabled:opacity-40 hover:bg-cream-deep transition">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
