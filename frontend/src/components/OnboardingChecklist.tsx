import React from 'react';
import { CheckCircle2, Circle, Package, Truck, Warehouse, ArrowRight } from 'lucide-react';
import type { OnboardingStatus } from './panelStore';

interface OnboardingChecklistProps {
  status: OnboardingStatus;
  onGoTo: (step: 'orders' | 'vehicles' | 'warehouses' | 'optimize') => void;
}

/**
 * Phase A empty-account checklist: 1. add orders → 2. add vehicles →
 * 3. add warehouses → 4. optimize. Fresh accounts start at 0/0/0.
 */
export const OnboardingChecklist: React.FC<OnboardingChecklistProps> = ({ status, onGoTo }) => {
  const steps = [
    { id: 'orders' as const, label: 'Add order neighborhoods', count: status.orderCount, icon: Package, done: status.hasOrders, hint: 'CSV/JSON upload, manual rows, or synthetic seeder (seed=42)' },
    { id: 'vehicles' as const, label: 'Add owned vehicles', count: status.vehicleCount, icon: Truck, done: status.hasVehicles, hint: 'Fleet table + validation + demo fleet seeder' },
    { id: 'warehouses' as const, label: 'Add existing warehouses', count: status.warehouseCount, icon: Warehouse, done: status.hasWarehouses, hint: ' doubles as D-baseline + E keep/abandon set' },
    { id: 'optimize' as const, label: 'Run optimization', count: -1, icon: ArrowRight, done: false, hint: 'Needs ≥1 order neighborhood' }
  ];
  return (
    <div className="card p-4 mb-4">
      <h2 className="text-[15px] font-bold text-ink mb-1">Getting started — {status.orderCount}/{status.vehicleCount}/{status.warehouseCount}</h2>
      <p className="text-xs text-ink-faint mb-3">
        New accounts start empty (0/0/0). Complete orders → vehicles → warehouses, then optimize.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {steps.map((s) => {
          const Icon = s.icon;
          const active = status.nextStep === s.id;
          return (
            <button key={s.id} onClick={() => onGoTo(s.id)}
              className={`text-left p-3 rounded-2xl border transition cursor-pointer ${s.done ? 'border-emerald-200 bg-emerald-50/60' : active ? 'border-[#14424E] bg-cream-deep' : 'border-[#E4E1D2] bg-white hover:bg-cream-deep'}`}>
              <div className="flex items-center gap-2 mb-1">
                {s.done ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Circle className={`w-4 h-4 ${active ? 'text-[#14424E]' : 'text-ink-faint'}`} />}
                <Icon className="w-4 h-4 text-ink-soft" />
                <span className="text-xs font-bold text-ink">{s.label}</span>
              </div>
              <div className="text-[11px] text-ink-faint">
                {s.count >= 0 ? `${s.count} added · ` : ''}{s.hint}
              </div>
              {active && <div className="text-[11px] font-bold text-[#14424E] mt-1">← next step</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
};
