import React, { useState } from 'react';
import { Route, Trash2 } from 'lucide-react';
import type { Assignment, ValidationResult } from '../types';

interface AssignmentTableProps {
  assignments: Assignment[];
  errors: ValidationResult['errors'];
  onChange: (updated: Assignment[]) => void;
  externalQuery?: string;
}

/** Read-only imported-plan table (neighborhood → warehouse rows + delete). */
export const AssignmentTable: React.FC<AssignmentTableProps> = ({
  assignments, errors, onChange, externalQuery = ''
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const q = (externalQuery || searchTerm).trim().toLowerCase();
  const rows = q
    ? assignments.filter((a) =>
        a.neighborhood_id.toLowerCase().includes(q) ||
        a.warehouse_id.toLowerCase().includes(q))
    : assignments;
  const errorRows = new Set((errors || []).map((e) => e.row).filter((r) => r != null));

  const removeAt = (idx: number) => {
    const target = rows[idx];
    onChange(assignments.filter((a) => a !== target));
  };

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <Route className="w-4 h-4 text-ink-faint" />
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter by node or warehouse…"
          className="flex-1 bg-cream-deep border border-[#E4E1D2] rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-gold"
        />
        <span className="text-[11px] font-mono text-ink-faint">{rows.length}/{assignments.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-cream-deep border-y border-[#E4E1D2] text-ink-faint font-semibold uppercase tracking-wider">
              <th className="py-2.5 px-4">Neighborhood</th>
              <th className="py-2.5 px-4">Warehouse</th>
              <th className="py-2.5 px-4 text-right">Distance (km)</th>
              <th className="py-2.5 px-4 w-16 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-ink-faint">
                  No assignments yet — use Import assignments above to upload a neighborhood → warehouse file.
                </td>
              </tr>
            ) : (
              rows.map((a, i) => (
                <tr key={`${a.neighborhood_id}→${a.warehouse_id}`} className="hover:bg-cream-deep transition-colors">
                  <td className="py-2.5 px-4 font-mono font-bold text-ink">{a.neighborhood_id}</td>
                  <td className="py-2.5 px-4 font-mono text-ink-soft">{a.warehouse_id}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-ink-soft">
                    {Number(a.distance_km).toFixed(2)}
                    {errorRows.size > 0 && <span className="ml-1 text-rose-500" title="Check validation">•</span>}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <button onClick={() => removeAt(i)} title="Remove row"
                      className="p-1.5 rounded-lg text-ink-faint hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
