import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Download, Search, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Neighborhood, ValidationErrorItem } from '../types';
import { exportCsv, exportJson } from '../services/api';

interface DataTableProps {
  neighborhoods: Neighborhood[];
  errors: ValidationErrorItem[];
  onChange: (updated: Neighborhood[]) => void;
  /** Extra filter from the top-bar search (combined with the table's own search). */
  externalQuery?: string;
}

export const DataTable: React.FC<DataTableProps> = ({ neighborhoods, errors, onChange, externalQuery = '' }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 15;

  // Build error map for fast lookup by row index
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

  // Filter rows (top-bar query AND table search both apply)
  const filtered = useMemo(() => {
    const terms = [externalQuery, searchTerm].map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (terms.length === 0) return neighborhoods;
    return neighborhoods.filter((n) =>
      terms.every(
        (term) =>
          n.neighborhood_id.toLowerCase().includes(term) ||
          (n.name && n.name.toLowerCase().includes(term)) ||
          (n.zone && n.zone.toLowerCase().includes(term))
      )
    );
  }, [neighborhoods, searchTerm, externalQuery]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const pageIndex = Math.min(currentPage, totalPages);
  const paginatedRows = filtered.slice((pageIndex - 1) * rowsPerPage, pageIndex * rowsPerPage);

  // Cell Edit
  const handleCellChange = (actualIndex: number, field: keyof Neighborhood, value: any) => {
    const updated = [...neighborhoods];
    let parsedValue = value;
    if (field === 'latitude' || field === 'longitude') {
      parsedValue = isNaN(parseFloat(value)) ? value : parseFloat(value);
    } else if (field === 'daily_orders') {
      parsedValue = isNaN(parseInt(value, 10)) ? value : parseInt(value, 10);
    }
    updated[actualIndex] = { ...updated[actualIndex], [field]: parsedValue };
    onChange(updated);
  };

  // Add Row
  const handleAddRow = () => {
    const nextId = `N${String(neighborhoods.length + 1).padStart(3, '0')}`;
    const newRow: Neighborhood = {
      neighborhood_id: nextId,
      name: `Neighborhood ${neighborhoods.length + 1}`,
      latitude: 17.385,
      longitude: 78.486,
      daily_orders: 50,
      zone: 'New Zone'
    };
    onChange([...neighborhoods, newRow]);
    setCurrentPage(Math.ceil((neighborhoods.length + 1) / rowsPerPage));
  };

  // Delete Row
  const handleDeleteRow = (actualIndex: number) => {
    const updated = neighborhoods.filter((_, idx) => idx !== actualIndex);
    onChange(updated);
  };

  // Download Handlers
  const handleExportCsv = async () => {
    const csvStr = await exportCsv(neighborhoods);
    const blob = new Blob([csvStr], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gridpoint_neighborhoods.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = async () => {
    const jsonStr = await exportJson(neighborhoods);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gridpoint_neighborhoods.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E4E1D2] shadow-sm overflow-hidden">
      {/* Table Toolbar */}
      <div className="p-3 border-b border-[#E4E1D2] flex flex-col items-stretch gap-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-ink-faint absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by ID, name, zone..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-cream-deep border border-[#E4E1D2] rounded-full focus:outline-none focus:border-gold"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-faint font-medium">
            Showing {filtered.length} of {neighborhoods.length} rows
          </span>
          <div className="flex items-center gap-1.5">
          <button
            onClick={handleAddRow}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-grape-100 text-grape-600 hover:bg-grape-200 rounded-full text-xs font-semibold transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Row</span>
          </button>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cream-deep hover:bg-gold-100 text-ink rounded-full text-xs font-semibold transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cream-deep hover:bg-gold-100 text-ink rounded-full text-xs font-semibold transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>
          </div>
        </div>
      </div>

      {/* Table Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-cream-deep border-b border-[#E4E1D2] text-ink-faint font-semibold uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">#</th>
              <th className="py-3 px-4 w-36">ID (Unique PK)</th>
              <th className="py-3 px-4">Name / Label</th>
              <th className="py-3 px-4 w-32">Latitude (°N)</th>
              <th className="py-3 px-4 w-32">Longitude (°E)</th>
              <th className="py-3 px-4 w-32">Orders (w_i)</th>
              <th className="py-3 px-4 w-32">Zone</th>
              <th className="py-3 px-4 w-16 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-faint">
                  No neighborhoods match current query or dataset is empty.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => {
                const actualIndex = neighborhoods.indexOf(row);
                const rowNum = actualIndex + 1;
                const rowErrors = errorMap.get(rowNum) || [];
                const hasError = rowErrors.length > 0;

                return (
                  <tr
                    key={row.neighborhood_id || actualIndex}
                    className={`hover:bg-cream-deep transition-colors ${
                      hasError ? 'bg-rose-50/40' : ''
                    }`}
                  >
                    <td className="py-2.5 px-4 text-center font-mono text-ink-faint">
                      {hasError ? (
                        <span title={rowErrors.map((e) => e.error).join('\n')}>
                          <AlertCircle className="w-4 h-4 text-rose-500 inline" />
                        </span>
                      ) : (
                        rowNum
                      )}
                    </td>

                    {/* ID */}
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={row.neighborhood_id}
                        onChange={(e) => handleCellChange(actualIndex, 'neighborhood_id', e.target.value)}
                        className="w-full bg-transparent font-mono font-medium text-ink focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5"
                      />
                    </td>

                    {/* Name */}
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={row.name || ''}
                        onChange={(e) => handleCellChange(actualIndex, 'name', e.target.value)}
                        className="w-full bg-transparent text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5"
                      />
                    </td>

                    {/* Latitude */}
                    <td className="py-2.5 px-4">
                      <input
                        type="number"
                        step="0.000001"
                        value={row.latitude}
                        onChange={(e) => handleCellChange(actualIndex, 'latitude', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5"
                      />
                    </td>

                    {/* Longitude */}
                    <td className="py-2.5 px-4">
                      <input
                        type="number"
                        step="0.000001"
                        value={row.longitude}
                        onChange={(e) => handleCellChange(actualIndex, 'longitude', e.target.value)}
                        className="w-full bg-transparent font-mono text-ink-soft focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5"
                      />
                    </td>

                    {/* Daily Orders */}
                    <td className="py-2.5 px-4">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={row.daily_orders}
                        onChange={(e) => handleCellChange(actualIndex, 'daily_orders', e.target.value)}
                        className="w-full bg-transparent font-mono font-bold text-ink focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5"
                      />
                    </td>

                    {/* Zone */}
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={row.zone || ''}
                        onChange={(e) => handleCellChange(actualIndex, 'zone', e.target.value)}
                        className="w-full bg-transparent text-ink-faint focus:bg-white focus:ring-1 focus:ring-gold rounded px-1 py-0.5"
                      />
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-4 text-center">
                      <button
                        onClick={() => handleDeleteRow(actualIndex)}
                        title="Delete record"
                        className="text-ink-faint hover:text-rose-600 transition p-1 cursor-pointer"
                      >
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

      {/* Pagination Footer */}
      <div className="p-3 border-t border-[#E4E1D2] flex items-center justify-between text-xs text-ink-faint">
        <div>
          Page {pageIndex} of {totalPages}
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={pageIndex === 1}
            className="p-1.5 rounded-lg border border-[#E4E1D2] disabled:opacity-40 hover:bg-cream-deep transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={pageIndex === totalPages}
            className="p-1.5 rounded-lg border border-[#E4E1D2] disabled:opacity-40 hover:bg-cream-deep transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
