import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { ValidationErrorItem } from '../types';

interface ErrorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  errors: ValidationErrorItem[];
  warnings: ValidationErrorItem[];
}

export const ErrorDrawer: React.FC<ErrorDrawerProps> = ({ isOpen, onClose, errors, warnings }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-200">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-5 h-5 text-rose-600" />
          <h3 className="font-bold text-slate-900 text-sm">Validation Diagnostics</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {errors.length === 0 && warnings.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            No validation errors or warnings detected.
          </div>
        ) : (
          <>
            {errors.map((err, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl bg-rose-50/70 border border-rose-200 text-xs text-rose-900 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-rose-700">
                    {err.row ? `Row ${err.row}` : 'Dataset Level'} &bull; {err.field}
                  </span>
                  <span className="font-mono text-[10px] bg-rose-200/60 text-rose-800 px-1.5 py-0.5 rounded">
                    {err.code}
                  </span>
                </div>
                <p className="text-rose-800">{err.error}</p>
                {err.value !== undefined && (
                  <p className="text-[11px] text-rose-600 font-mono">Value: {String(err.value)}</p>
                )}
              </div>
            ))}

            {warnings.map((warn, idx) => (
              <div
                key={`warn-${idx}`}
                className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-700">
                    {warn.row ? `Row ${warn.row}` : 'Configuration'} &bull; {warn.field}
                  </span>
                  <span className="font-mono text-[10px] bg-amber-200/60 text-amber-800 px-1.5 py-0.5 rounded">
                    {warn.code}
                  </span>
                </div>
                <p className="text-amber-800">{warn.error}</p>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-xs font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl transition cursor-pointer"
        >
          Close Diagnostics
        </button>
      </div>
    </div>
  );
};
