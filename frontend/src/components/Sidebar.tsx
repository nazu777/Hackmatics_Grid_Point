import React from 'react';
import {
  LayoutDashboard,
  Warehouse,
  Package,
  Truck,
  Boxes,
  Route,
  FileDown,
  Settings,
  Headphones
} from 'lucide-react';

export type AppView =
  | 'dashboard'
  | 'warehouses'
  | 'orders'
  | 'shipments'
  | 'inventory'
  | 'tracking'
  | 'export'
  | 'settings'
  | 'help';

interface SidebarProps {
  view: AppView;
  onNavigate: (v: AppView) => void;
  resultReady: boolean;
}

const MAIN_NAV: { id: AppView; label: string; icon: React.ElementType; needsResult?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'warehouses', label: 'Warehouses', icon: Warehouse },
  { id: 'orders', label: 'Orders', icon: Package },
  { id: 'shipments', label: 'Shipments', icon: Truck },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'tracking', label: 'Tracking', icon: Route },
  { id: 'export', label: 'Export Reports', icon: FileDown },
];

const BOTTOM_NAV: { id: AppView; label: string; icon: React.ElementType }[] = [
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'help', label: 'Help Center', icon: Headphones },
];

export const Sidebar: React.FC<SidebarProps> = ({ view, onNavigate, resultReady }) => {
  const renderItem = (item: { id: AppView; label: string; icon: React.ElementType; needsResult?: boolean }) => {
    const Icon = item.icon;
    const selected = view === item.id;
    const locked = !!item.needsResult && !resultReady;
    return (
      <button
        key={item.id}
        onClick={() => onNavigate(item.id)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-[13px] font-medium transition-all cursor-pointer ${
          selected
            ? 'bg-gold text-ink shadow-md shadow-black/20 font-semibold'
            : 'text-[#9FB9BE] hover:text-white hover:bg-white/10'
        } ${locked ? 'opacity-50' : ''}`}
      >
        <Icon className="w-[18px] h-[18px] shrink-0" />
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  return (
    <aside className="w-[228px] shrink-0 bg-[#0D3542] text-white flex flex-col min-h-screen sticky top-0 h-screen">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-6 pt-7 pb-8">
        <span className="w-8 h-8 rounded-lg bg-gold flex items-center justify-center">
          <Warehouse className="w-5 h-5 text-ink" />
        </span>
        <span className="font-display font-semibold text-[22px] tracking-tight">GridPoint</span>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto nice-scroll">
        {MAIN_NAV.map(renderItem)}
      </nav>

      {/* Bottom nav */}
      <nav className="px-4 pb-6 pt-4 space-y-1.5 border-t border-white/10 mx-2">
        {BOTTOM_NAV.map(renderItem)}
      </nav>
    </aside>
  );
};
