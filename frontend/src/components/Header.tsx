import React from 'react';
import { MapPin, Layers, Cpu, BarChart3, Sliders } from 'lucide-react';

interface HeaderProps {
  activePhase: number;
  setActivePhase: (phase: number) => void;
}

export const Header: React.FC<HeaderProps> = ({ activePhase, setActivePhase }) => {
  const phases = [
    { id: 1, name: '1. Ingestion & Data', icon: Layers, active: true },
    { id: 2, name: '2. Map Visualizer', icon: MapPin, active: true, tooltip: 'Phase 2: Geographic Demand Map & Controls' },
    { id: 3, name: '3. Warehouse Optimizer', icon: Cpu, active: true, tooltip: 'Phase 3: Core Optimization Engine' },
    { id: 4, name: '4. Cost Comparison', icon: BarChart3, active: true, tooltip: 'Phase 4: Baseline vs Optimized Cost Dashboard' },
    { id: 5, name: '5. Scenarios & Fleet', icon: Sliders, active: false, tooltip: 'Phase 5' },
  ];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-600/20 font-bold text-xl">
              📍
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-xl tracking-tight text-slate-900">GRIDPOINT</span>
                <span className="text-xs uppercase px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-800 tracking-wider">
                  v1.0 (Hack-A-Matics)
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">Where Should the Warehouse Go? &bull; Location Optimization Platform</p>
            </div>
          </div>

          <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl">
            {phases.map((p) => {
              const Icon = p.icon;
              const isSelected = activePhase === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setActivePhase(p.id)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isSelected
                      ? 'bg-white text-emerald-700 shadow-sm'
                      : p.active
                      ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      : 'text-slate-400 cursor-not-allowed opacity-60'
                  }`}
                  title={!p.active ? `${p.tooltip} (Sequential Sprint)` : undefined}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">{p.name}</span>
                  <span className="md:hidden">P{p.id}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
};
