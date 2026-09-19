import React from 'react';
import { MapPin, Package, TrendingUp, ShieldCheck, AlertTriangle } from 'lucide-react';
import { DatasetSummary, ValidationResult } from '../types';

interface SummaryCardsProps {
  summary: DatasetSummary;
  validation: ValidationResult;
  onOpenErrors: () => void;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ summary, validation, onOpenErrors }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* Total Nodes */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Demand Nodes (N)</p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">{summary.count.toLocaleString()}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Active neighborhoods</p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <MapPin className="w-6 h-6" />
        </div>
      </div>

      {/* Total Orders */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Demand (Σ w_i)</p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">{summary.total_orders.toLocaleString()}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Orders per day across network</p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
          <Package className="w-6 h-6" />
        </div>
      </div>

      {/* Avg Volume */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Avg Daily Volume</p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">{summary.avg_orders.toFixed(1)}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Range: {summary.min_orders} – {summary.max_orders} orders</p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
          <TrendingUp className="w-6 h-6" />
        </div>
      </div>

      {/* Validation Status */}
      <div 
        onClick={!validation.valid ? onOpenErrors : undefined}
        className={`bg-white p-5 rounded-2xl border shadow-sm flex items-center justify-between transition-all ${
          validation.valid 
            ? 'border-emerald-200' 
            : 'border-rose-200 cursor-pointer hover:bg-rose-50/50'
        }`}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Schema Validation</p>
          <div className="flex items-center space-x-2 mt-1">
            <h3 className={`text-2xl font-bold ${validation.valid ? 'text-emerald-600' : 'text-rose-600'}`}>
              {validation.valid ? '100% Valid' : `${validation.errors.length} Issues`}
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {validation.valid 
              ? `${validation.valid_rows} of ${validation.total_rows} rows passed` 
              : 'Click to inspect errors'}
          </p>
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
          validation.valid ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
        }`}>
          {validation.valid ? <ShieldCheck className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
        </div>
      </div>
    </div>
  );
};
