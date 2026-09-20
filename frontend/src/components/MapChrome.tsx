import React from 'react';
import { Warehouse, Route, CircleDot, Radar, Siren, Flame } from 'lucide-react';
import type { Neighborhood } from '../types';

/** Floating category chips over the map (gmaps "Nearby hotels / Restaurants…" pattern). */
export interface LayerFlags {
  warehouses: boolean;
  routes: boolean;
  demand: boolean;
  radius: boolean;
  traffic: boolean;
  /** Phase B (#2): proximity heatmap (green near → red far). */
  heatmap: boolean;
}

interface MapChipsProps {
  layers: LayerFlags;
  onToggle: (key: keyof LayerFlags) => void;
  hasResult: boolean;
}

const CHIP_DEFS: { id: keyof LayerFlags; label: string; icon: React.ElementType }[] = [
  { id: 'warehouses', label: 'Warehouses', icon: Warehouse },
  { id: 'routes', label: 'Routes', icon: Route },
  { id: 'traffic', label: 'Traffic', icon: Siren },
  { id: 'heatmap', label: 'Heatmap', icon: Flame },
  { id: 'demand', label: 'Demand', icon: CircleDot },
  { id: 'radius', label: 'Radius', icon: Radar }
];

export const MapChips: React.FC<MapChipsProps> = ({ layers, onToggle, hasResult }) => (
  <div className="flex gap-2 overflow-x-auto nice-scroll max-w-full">
    {CHIP_DEFS.map((c) => {
      const Icon = c.icon;
      const on = layers[c.id];
      const disabled = !hasResult && (c.id === 'warehouses' || c.id === 'routes' || c.id === 'radius' || c.id === 'traffic' || c.id === 'heatmap');
      return (
        <button
          key={c.id}
          disabled={disabled}
          onClick={() => onToggle(c.id)}
          title={disabled ? 'Run the optimizer to unlock' : c.id === 'traffic' ? 'Color routes by corridor congestion (green→amber→red)' : c.id === 'heatmap' ? 'City-wide coverage zones: green near a warehouse, red far' : `Toggle ${c.label.toLowerCase()} layer`}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold whitespace-nowrap border transition cursor-pointer shadow-sm ${
            on
              ? 'bg-white text-ink border-white'
              : 'bg-white/70 text-ink-faint border-white/50 hover:bg-white'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Icon className="w-4 h-4" />
          {c.label}
        </button>
      );
    })}
  </div>
);

/** Tappable search-result rows (used for Ask multi-hits and top-demand lists). */
export const ResultRows: React.FC<{
  nodes: Neighborhood[];
  title: string;
  onOpen: (n: Neighborhood) => void;
  onClose: () => void;
}> = ({ nodes, title, onOpen, onClose }) => (
  <div className="flex flex-col h-full">
    <div className="px-5 pr-14 pt-5 flex items-center justify-between">
      <h2 className="font-display font-semibold text-[22px] text-ink leading-tight">{title}</h2>
      <button
        onClick={onClose}
        className="text-xs font-bold text-ink-soft hover:text-ink transition cursor-pointer"
      >
        ✕
      </button>
    </div>
    <div className="flex-1 overflow-y-auto nice-scroll p-4 space-y-1.5">
      {nodes.map((n) => (
        <button
          key={n.neighborhood_id}
          onClick={() => onOpen(n)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-2xl hover:bg-cream-deep transition cursor-pointer text-left"
        >
          <span className="min-w-0">
            <span className="block text-[13px] font-bold text-ink truncate">
              <span className="font-mono">{n.neighborhood_id}</span> • {n.name}
            </span>
            <span className="block text-[11px] text-ink-faint">
              {n.daily_orders} orders • {n.zone || 'Unzoned'}
            </span>
          </span>
          <span className="text-ink-faint text-lg leading-none shrink-0">›</span>
        </button>
      ))}
      {nodes.length === 0 && <p className="text-xs text-ink-faint text-center py-6">Nothing here.</p>}
    </div>
  </div>
);
