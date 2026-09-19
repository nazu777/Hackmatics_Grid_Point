import React, { useState } from 'react';
import { Palette, RotateCcw, Sparkles } from 'lucide-react';
import type { Neighborhood, ZoneColorMap } from '../types';
import { applyLandUsePreset, colorForZone, distinctZones, zoneCounts } from './mapThemes';

interface ZoneLegendEditorProps {
  neighborhoods: Neighborhood[];
  zoneColors: ZoneColorMap;
  onZoneColorChange: (zone: string, color: string) => void;
  onResetZoneColors: () => void;
  /** Called with remapped neighborhoods when the demo preset is applied. */
  onApplyZones?: (updated: Neighborhood[]) => void;
  compact?: boolean;
}

export const ZoneLegendEditor: React.FC<ZoneLegendEditorProps> = ({
  neighborhoods,
  zoneColors,
  onZoneColorChange,
  onResetZoneColors,
  onApplyZones,
  compact = false
}) => {
  const [confirmPreset, setConfirmPreset] = useState(false);
  const zones = distinctZones(neighborhoods);
  const counts = zoneCounts(neighborhoods);
  const hasCustom = Object.keys(zoneColors).length > 0;

  const handlePreset = () => {
    if (!confirmPreset) {
      setConfirmPreset(true);
      return;
    }
    if (onApplyZones) {
      onApplyZones(applyLandUsePreset(neighborhoods));
    }
    setConfirmPreset(false);
  };

  return (
    <div className={`bg-white rounded-3xl border border-slate-200 shadow-sm ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
          <Palette className="w-4 h-4 text-violet-600" />
          Zone / Category Theme
        </h4>
        {hasCustom && (
          <button
            onClick={onResetZoneColors}
            title="Reset custom colors to defaults"
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 transition cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500 mb-3">
        Pick a color per category — e.g. Residential green, Commercial blue. Saved automatically.
      </p>

      <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
        {zones.map((z) => (
          <label key={z} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-50 transition cursor-pointer">
            <input
              type="color"
              value={colorForZone(z, zoneColors)}
              onChange={(e) => onZoneColorChange(z, e.target.value)}
              className="w-7 h-7 rounded-lg border border-slate-200 p-0.5 bg-white cursor-pointer shrink-0"
              title={`Color for ${z}`}
            />
            <span className="text-xs font-medium text-slate-700 flex-1 truncate">{z}</span>
            <span className="text-[11px] font-mono text-slate-400">{counts[z]} nodes</span>
          </label>
        ))}
        {zones.length === 0 && (
          <p className="text-[11px] text-slate-400">No neighborhoods loaded.</p>
        )}
      </div>

      {onApplyZones && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <button
            onClick={handlePreset}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              confirmPreset
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-violet-50 hover:bg-violet-100 text-violet-800 border border-violet-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {confirmPreset ? 'Click again to overwrite zones with demo categories' : 'Load land-use demo categories'}
          </button>
          {confirmPreset ? (
            <p className="text-[10px] text-amber-700 mt-1.5">
              Replaces every zone with Residential / Commercial / Industrial / Mixed. You can still edit zones manually in Phase 1.
            </p>
          ) : (
            <p className="text-[10px] text-slate-400 mt-1.5">
              …or type categories (e.g. Residential) directly into the zone column in Phase 1.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
