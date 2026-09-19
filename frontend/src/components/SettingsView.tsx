import React from 'react';
import { Sun, Moon, Map as MapIcon, Palette, Database, PhoneCall } from 'lucide-react';
import type { BasemapStyle, ColorByMode, MapLayerOptions } from '../types';
import type { ThemeMode } from './Topbar';
import { BASEMAPS } from './mapThemes';

interface SettingsViewProps {
  theme: ThemeMode;
  onThemeChange: (t: ThemeMode) => void;
  mapLayerOptions: MapLayerOptions;
  setMapLayerOptions: React.Dispatch<React.SetStateAction<MapLayerOptions>>;
  onResetZoneColors: () => void;
  onClearData: () => void;
  apiBase: string;
}

export const SUPPORT_CONTACTS = [
  { name: 'GridPoint Ops Desk', detail: 'Mon–Sat, 9am–7pm IST', phone: '+91-80-4719-2400' },
  { name: 'Field Team Lead', detail: 'Warehouse onboarding & surveys', phone: '+91-98450-31764' },
  { name: 'Toll-free Support', detail: '24×7 IVR + callback', phone: '1800-419-0300' }
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  theme,
  onThemeChange,
  mapLayerOptions,
  setMapLayerOptions,
  onResetZoneColors,
  onClearData,
  apiBase
}) => (
  <div className="space-y-5 max-w-3xl">
    {/* Appearance */}
    <div className="card p-5">
      <h3 className="font-bold text-[15px] text-ink flex items-center gap-2">
        {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />} Appearance
      </h3>
      <p className="text-xs text-ink-faint mt-1 mb-3">Website light / dark mode. Applies instantly and is remembered.</p>
      <div className="flex gap-2">
        {(['light', 'dark'] as ThemeMode[]).map((t) => (
          <button
            key={t}
            onClick={() => onThemeChange(t)}
            className={`px-5 py-2 rounded-full text-xs font-bold capitalize transition cursor-pointer ${
              theme === t ? 'bg-[#14424E] text-white' : 'bg-cream-deep text-ink hover:bg-gold-100'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>

    {/* Map defaults */}
    <div className="card p-5">
      <h3 className="font-bold text-[15px] text-ink flex items-center gap-2">
        <MapIcon className="w-4 h-4" /> Default map theme
      </h3>
      <p className="text-xs text-ink-faint mt-1 mb-3">Used on every map until you switch it there.</p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(BASEMAPS) as BasemapStyle[]).map((b) => (
          <button
            key={b}
            onClick={() => setMapLayerOptions((prev) => ({ ...prev, basemap: b }))}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
              mapLayerOptions.basemap === b ? 'bg-[#14424E] text-white' : 'bg-cream-deep text-ink hover:bg-gold-100'
            }`}
          >
            {BASEMAPS[b].label}
          </button>
        ))}
      </div>
      <h3 className="font-bold text-[15px] text-ink flex items-center gap-2 mt-5">
        <Palette className="w-4 h-4" /> Default bubble coloring
      </h3>
      <p className="text-xs text-ink-faint mt-1 mb-3">Warehouse, zone category or demand intensity.</p>
      <div className="flex flex-wrap gap-2">
        {(['warehouse', 'zone', 'demand'] as ColorByMode[]).map((c) => (
          <button
            key={c}
            onClick={() => setMapLayerOptions((prev) => ({ ...prev, colorBy: c }))}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition cursor-pointer ${
              mapLayerOptions.colorBy === c ? 'bg-[#14424E] text-white' : 'bg-cream-deep text-ink hover:bg-gold-100'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
    </div>

    {/* Zone themes + data */}
    <div className="card p-5">
      <h3 className="font-bold text-[15px] text-ink flex items-center gap-2">
        <Database className="w-4 h-4" /> Themes & data
      </h3>
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          onClick={onResetZoneColors}
          className="px-4 py-2 rounded-full bg-cream-deep text-ink text-xs font-bold hover:bg-gold-100 transition cursor-pointer"
        >
          Reset custom zone colors
        </button>
        <button
          onClick={onClearData}
          className="px-4 py-2 rounded-full bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 transition cursor-pointer"
        >
          Reset all saved app data
        </button>
      </div>
      <p className="text-[11px] text-ink-faint mt-3">
        Backend: <span className="font-mono">{apiBase}</span> • Schema v1.0.0 • GridPoint for HACK-A-MATICS
      </p>
    </div>

    {/* Support contacts */}
    <div className="card p-5">
      <h3 className="font-bold text-[15px] text-ink flex items-center gap-2">
        <PhoneCall className="w-4 h-4" /> Support contacts
      </h3>
      <p className="text-xs text-ink-faint mt-1 mb-3">Demo contacts for warehouse onboarding and delivery ops.</p>
      <div className="grid gap-2">
        {SUPPORT_CONTACTS.map((c) => (
          <a
            key={c.phone}
            href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}
            className="flex items-center justify-between rounded-2xl border border-[#ECE9DB] px-4 py-3 hover:border-gold transition cursor-pointer bg-cream-deep"
          >
            <span>
              <span className="block text-[13px] font-bold text-ink">{c.name}</span>
              <span className="block text-[11px] text-ink-faint">{c.detail}</span>
            </span>
            <span className="font-mono text-[13px] font-bold text-[#14424E]">{c.phone}</span>
          </a>
        ))}
      </div>
    </div>
  </div>
);
