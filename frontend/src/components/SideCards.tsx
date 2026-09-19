import React from 'react';
import { Plus, Pencil, Trash2, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { OptimizationResult, ValidationResult } from '../types';

/** Quick action shortcuts used in the right rail. */
export const QuickActions: React.FC<{
  onAddRequest: () => void;
  onEdit: () => void;
  onRun: () => void;
  onDeleteResult?: () => void;
  hasResult: boolean;
}> = ({ onAddRequest, onEdit, onRun, onDeleteResult, hasResult }) => (
  <div className="card p-4 space-y-2">
    <h4 className="font-bold text-xs text-ink">Quick Actions</h4>
    <button
      onClick={onAddRequest}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-cream-deep text-ink text-xs font-bold hover:bg-gold-100 transition cursor-pointer"
    >
      <Plus className="w-3.5 h-3.5" /> Add demand request
    </button>
    <button
      onClick={onEdit}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-cream-deep text-ink text-xs font-bold hover:bg-gold-100 transition cursor-pointer"
    >
      <Pencil className="w-3.5 h-3.5" /> Edit optimizer settings
    </button>
    <button
      onClick={onRun}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-pine-700 text-white text-xs font-bold hover:bg-pine-800 transition cursor-pointer"
    >
      <Zap className="w-3.5 h-3.5" /> {hasResult ? 'Re-run optimization' : 'Run optimization'}
    </button>
    {hasResult && onDeleteResult && (
      <button
        onClick={onDeleteResult}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-cream-deep text-ink text-xs font-bold hover:bg-red-100 hover:text-red-700 transition cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" /> Discard result
      </button>
    )}
  </div>
);

/** Compact validation status for the rail. */
export const ValidationMini: React.FC<{
  validation: ValidationResult;
  onOpenErrors: () => void;
}> = ({ validation, onOpenErrors }) => (
  <div className="card p-4">
    <div className="flex items-center justify-between">
      <h4 className="font-bold text-xs text-ink">Data Health</h4>
      {validation.valid ? (
        <span className="flex items-center gap-1 text-[11px] font-bold text-pine-600">
          <CheckCircle2 className="w-3.5 h-3.5" /> Valid
        </span>
      ) : (
        <button
          onClick={onOpenErrors}
          className="flex items-center gap-1 text-[11px] font-bold text-red-600 hover:underline cursor-pointer"
        >
          <AlertTriangle className="w-3.5 h-3.5" /> {validation.errors.length} issues
        </button>
      )}
    </div>
    <p className="text-[11px] text-ink-faint mt-1.5">
      {validation.valid_rows}/{validation.total_rows} rows valid
      {validation.warnings.length > 0 && ` • ${validation.warnings.length} warnings`}
    </p>
  </div>
);

/** Compact result summary for rails that need context. */
export const ResultMini: React.FC<{ result: OptimizationResult | null }> = ({ result }) => {
  if (!result) {
    return (
      <div className="card p-4">
        <h4 className="font-bold text-xs text-ink">Optimization</h4>
        <p className="text-[11px] text-ink-faint mt-1">No result yet — run the optimizer to fill this in.</p>
      </div>
    );
  }
  const rows: [string, string][] = [
    ['Warehouses (K)', String(result.warehouses.length)],
    ['Metric', result.config.distance_metric],
    ['Avg km / order', `${result.metrics.avg_distance_per_order_km}`],
    ['Feasibility', `${(result.metrics.feasibility_ratio * 100).toFixed(0)}%`],
    ['Cost saved', `$${result.comparison?.delta.cost_saved.toLocaleString() ?? 0} (${result.comparison?.delta.pct_cost_saved ?? 0}%)`]
  ];
  return (
    <div className="card p-4">
      <h4 className="font-bold text-xs text-ink mb-2">Optimization</h4>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-[11px]">
            <span className="text-ink-faint">{k}</span>
            <span className="font-bold font-mono text-ink">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
