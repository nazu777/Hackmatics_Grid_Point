import React from 'react';
import { Search, Bell, CalendarDays, Sun, Moon, ChevronDown } from 'lucide-react';

export type ThemeMode = 'light' | 'dark';

interface TopbarProps {
  query: string;
  onQuery: (q: string) => void;
  errorCount: number;
  onOpenErrors: () => void;
  theme: ThemeMode;
  onThemeChange: (t: ThemeMode) => void;
}

export const Topbar: React.FC<TopbarProps> = ({ query, onQuery, errorCount, onOpenErrors, theme, onThemeChange }) => {
  return (
    <div className="flex items-center gap-3 py-5">
      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Find inventory, orders or reports"
          className="w-full pl-5 pr-12 py-2.5 text-[13px] bg-white border border-[#E4E1D2] rounded-full placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-gold/60 focus:border-gold"
        />
        <Search className="w-[18px] h-[18px] text-ink absolute right-4 top-1/2 -translate-y-1/2" />
      </div>

      <div className="flex-1" />

      {/* Bell (validation errors) */}
      <button
        onClick={onOpenErrors}
        title={errorCount > 0 ? `${errorCount} validation issues` : 'No validation issues'}
        className="relative w-10 h-10 rounded-full bg-white border border-[#E4E1D2] flex items-center justify-center text-ink hover:border-gold transition cursor-pointer"
      >
        <Bell className="w-[18px] h-[18px]" />
        {errorCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {errorCount}
          </span>
        )}
      </button>

      {/* Calendar */}
      <button
        title={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        className="w-10 h-10 rounded-full bg-white border border-[#E4E1D2] flex items-center justify-center text-ink hover:border-gold transition cursor-pointer"
      >
        <CalendarDays className="w-[18px] h-[18px]" />
      </button>

      {/* Light / dark website theme */}
      <div className="flex items-center bg-white border border-[#E4E1D2] rounded-full p-1 gap-1">
        <button
          onClick={() => onThemeChange('light')}
          title="Light mode"
          className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer ${
            theme === 'light' ? 'bg-gold text-ink' : 'text-ink-faint hover:text-ink'
          }`}
        >
          <Sun className="w-4 h-4" />
        </button>
        <button
          onClick={() => onThemeChange('dark')}
          title="Dark mode"
          className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer ${
            theme === 'dark' ? 'bg-gold text-ink' : 'text-ink-faint hover:text-ink'
          }`}
        >
          <Moon className="w-4 h-4" />
        </button>
      </div>

      {/* User */}
      <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-white transition cursor-pointer">
        <span className="w-9 h-9 rounded-full bg-gradient-to-br from-gold-300 to-gold-600 flex items-center justify-center text-ink text-xs font-bold">
          OP
        </span>
        <span className="text-[13px] font-semibold text-ink hidden lg:inline">Operator</span>
        <ChevronDown className="w-4 h-4 text-ink-faint" />
      </button>
    </div>
  );
};
