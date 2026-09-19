import React from 'react';
import {
  Sparkles,
  Bookmark,
  Warehouse,
  Scale,
  Package,
  FlaskConical,
  FileDown,
  Settings,
  LifeBuoy,
  Sun,
  Moon
} from 'lucide-react';
import type { ThemeMode } from './Topbar';

export type RailTab =
  | 'ask'
  | 'saved'
  | 'optimize'
  | 'compare'
  | 'data'
  | 'lab'
  | 'export'
  | 'settings'
  | 'help';

interface GmapsRailProps {
  tab: RailTab;
  onTab: (t: RailTab) => void;
  theme: ThemeMode;
  onThemeChange: (t: ThemeMode) => void;
}

const ITEMS: { id: RailTab; label: string; icon: React.ElementType }[] = [
  { id: 'ask', label: 'Ask GridPoint', icon: Sparkles },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'optimize', label: 'Optimize', icon: Warehouse },
  { id: 'compare', label: 'Compare', icon: Scale },
  { id: 'data', label: 'Demand data', icon: Package },
  { id: 'lab', label: 'Scenario lab', icon: FlaskConical },
  { id: 'export', label: 'Export', icon: FileDown }
];

const BOTTOM: { id: RailTab; label: string; icon: React.ElementType }[] = [
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'help', label: 'Help', icon: LifeBuoy }
];

export const GmapsRail: React.FC<GmapsRailProps> = ({ tab, onTab, theme, onThemeChange }) => {
  const render = (item: { id: RailTab; label: string; icon: React.ElementType }) => {
    const Icon = item.icon;
    const active = tab === item.id;
    return (
      <button
        key={item.id}
        onClick={() => onTab(item.id)}
        title={item.label}
        className="flex flex-col items-center gap-1 py-2 cursor-pointer group w-full"
      >
        <span
          className={`w-11 h-11 rounded-2xl flex items-center justify-center transition ${
            active ? 'bg-grape-500 text-white shadow-md shadow-grape-500/30' : 'text-ink-faint group-hover:bg-cream-deep group-hover:text-ink'
          }`}
        >
          <Icon className="w-5 h-5" />
        </span>
        <span className={`text-[9px] font-semibold leading-none ${active ? 'text-ink' : 'text-ink-faint'}`}>
          {item.label.split(' ')[0]}
        </span>
      </button>
    );
  };

  return (
    <nav className="w-[76px] shrink-0 bg-white border-r border-[#E4E1D2] flex flex-col items-center py-3 z-20">
      <span className="w-9 h-9 rounded-xl bg-[#14424E] flex items-center justify-center mb-2">
        <Warehouse className="w-5 h-5 text-white" />
      </span>
      <div className="flex-1 overflow-y-auto nice-scroll w-full px-1.5 space-y-0.5">
        {ITEMS.map(render)}
      </div>
      <div className="w-full px-1.5 space-y-0.5 pt-2 border-t border-[#E4E1D2]">
        {BOTTOM.map(render)}
        <button
          onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="flex flex-col items-center gap-1 py-2 cursor-pointer group w-full"
        >
          <span className="w-11 h-11 rounded-2xl flex items-center justify-center transition text-ink-faint group-hover:bg-cream-deep group-hover:text-ink">
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </span>
          <span className="text-[9px] font-semibold leading-none text-ink-faint">Theme</span>
        </button>
        <div className="flex flex-col items-center gap-1 py-2">
          <span className="w-9 h-9 rounded-full bg-gradient-to-br from-grape-300 to-grape-600 flex items-center justify-center text-white text-[11px] font-bold">
            OP
          </span>
        </div>
      </div>
    </nav>
  );
};
