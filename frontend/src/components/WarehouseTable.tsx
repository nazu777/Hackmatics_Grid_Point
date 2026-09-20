import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Download, Search, AlertCircle, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { Warehouse, ValidationErrorItem } from '../types';
import { fetchSyntheticWarehouses } from '../services/api';

interface WarehouseTableProps {
  warehouses: Warehouse[];
  errors: ValidationErrorItem[];
  onChange: (updated: Warehouse[]) => void;
  externalQuery?: string;
  center?: { lat: number; lon: number } | null;
}

export const WarehouseTable: React.FC<WarehouseTableProps> = ({ warehouses, errors, onChange, externalQuery = '', center }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [seeding, setSeeding] = useState(false);
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
    if (terms.length === 0) return warehouses;
    return warehouses.filter((w) =>
      terms.every((term) => w.warehouse_id.toLowerCase().includes(term))
    );
  }, [warehouses, searchTerm, externalQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const pageIndex = Math.min(currentPage, totalPages);
  const paginatedRows = filtered.slice((pageIndex - 1) * rowsPerPage, pageIndex * rowsPerPage);

  const handleCellChange = (actualIndex: number, field: keyof Warehouse, value: any) => {
    const updated = [...warehouses];
    let parsed: any = value;
    if (field === 'latitude' || field === 'longitude' || field === 'radius_km' || field === 'infra_cost') {
      parsed = value === '' ? null : (isNaN(parseFloat(value)) ? value : parseFloat(value));
    } else if (field === 'capacity') {
      parsed = value === '' ? null : (isNaN(parseInt(value, 10)) ? value : parseInt(value, 10));
    }
    (updated[actualIndex] as any) = { ...updated[actualIndex], [field]: parsed };
    onChange(updated);
  };

  const handleAddRow = () => {
    const n = warehouses.length + 1;
    const row: Warehouse = {
      warehouse_id: `EX-W${n}`,
      latitude: center?.lat ?? 17.385,
      longitude: center?.lon ?? 78.486,
      capacity: 800,
      radius_km: 25,
      infra_cost: 1500,
      assigned_orders: 0
    };
    onChange([...warehouses, row]);
    setCurrentPage(Math.ceil((warehouses.length + 1) / rowsPerPage));
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const seed = await fetchSyntheticWarehouses(42, 2, center?.lat ?? 17.385044, center?.lon ?? 78.486671);
      onChange(seed);
    } finally {
      setSeeding(false);
    }
  };

  const handleExport = () => {
    const header = 'warehouse_id,latitude,longitude,capacity,radius_km,infra_cost';
    const rows = warehouses.map((w) =>
      [w.warehouse_id, w.latitude, w.longitude, w.capacity ?? '', w.radius_km ?? '', w.infra_cost ?? 0].join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gridpoint_warehouses.csv';
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
              placeholder="Search warehouses by ID..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-cream-deep border border-[#E4E1D2] rounded-full focus:outline-none focus:border-gold"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-faint font-medium">
            Showing {filtered.length} of {warehouses.length} existing sites (D-baseline + E keep set)
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={handleSeed} disabled={seeding}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-semibold transition cursor-pointer disabled:opacity-50">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{seeding ? 'Seeding...' : 'Seed demo sites (seed=42)'}</span>
            </button>
            <button onClick={handleAddRow}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-grape-100 text-grape-600 hover:bg-grape-200 rounded-full text-xs font-semibold transition cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
              <span>Add Site</span>
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
              <th className="py-3 px-4">Warehouse ID (unique)</th>
              <th className="py-3 px-4 w-32">Latitude</th>
              <th className="py-3 px-4 w-32">Longitude</th>
              <th className="py-3 px-4 w-28">Capacity</th>
              <th className="py-3 px-4 w-28">Radius km</th>
              <th className="py-3 px-4 w-28">Infra Cost</th>
              <th className="py-3 px-4 w-16 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-faint">
                  No existing warehouses yet — add sites manually, upload a CSV/JSON, or seed demo sites.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => {
                const actualIndex = warehouses.indexOf(row);
                const rowNum = actualIndex + 1;
                const rowErrors = errorMap.get(rowNum) || [];
                const hasError = rowErrors.length > 0;
                return (
                  <tr key={row.warehouse_id || actualIndex} className={`hover:bg-cream-deep transition-colors ${hasError ? 'bg-rose-50/40' : ''}`}>
                    <td className="py-2.5 px-4 text-center font-mono text-ink-faint">
                      {hasError ? (
                        <span title={rowErrors.map((e) => `[${e.code}] ${e.field}: ${e.error}`).join('\n')}>
                          <AlertCircle className="w-4 h-4 text-rose-500 inline" />
                        </span>
                      ) : rowNum}
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="text" value={row.warehouse_id}
                        onChange={(e) => handleCellChange(actualIndex, 'warehouse_id', e.target.value)}
                        className="w-full bg-transparent font-mono font-medium text-ink focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="number" step="0.000001" value={row.latitude as any}
                        onChange={(e) => handleCellChange(actualIndex, 'latitude', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="number" step="0.000001" value={row.longitude as any}
                        onChange={(e) => handleCellChange(actualIndex, 'longitude', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="number" min="1" step="1" value={(row.capacity as any) ?? ''}
                        onChange={(e) => handleCellChange(actualIndex, 'capacity', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="number" min="0.1" step="0.5" value={(row.radius_km as any) ?? ''}
                        onChange={(e) => handleCellChange(actualIndex, 'radius_km', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4">
                      <input type="number" min="0" step="10" value={(row.infra_cost as any) ?? 0}
                        onChange={(e) => handleCellChange(actualIndex, 'infra_cost', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5" />
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <button onClick={() => onChange(warehouses.filter((_, i) => i !== actualIndex))}
                        title="Delete site" className="text-ink-faint hover:text-rose-600 transition p-1 cursor-pointer">
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
