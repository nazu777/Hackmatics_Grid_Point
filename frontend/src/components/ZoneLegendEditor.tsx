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
    <div className={`card ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-bold text-xs text-ink flex items-center gap-1.5">
          <Palette className="w-4 h-4 text-grape-500" />
          Zone / Category Theme
        </h4>
        {hasCustom && (
          <button
            onClick={onResetZoneColors}
            title="Reset custom colors to defaults"
            className="flex items-center gap-1 text-[11px] font-semibold text-ink-faint hover:text-ink transition cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        )}
      </div>
      <p className="text-[11px] text-ink-faint mb-3">
        Pick a color per category — saved automatically.
      </p>

      <div className="space-y-1.5 max-h-44 overflow-y-auto nice-scroll pr-1">
        {zones.map((z) => (
          <label key={z} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-cream-deep transition cursor-pointer">
            <input
              type="color"
              value={colorForZone(z, zoneColors)}
              onChange={(e) => onZoneColorChange(z, e.target.value)}
              className="w-7 h-7 rounded-lg border border-[#E4E1D2] p-0.5 bg-white cursor-pointer shrink-0"
              title={`Color for ${z}`}
            />
            <span className="text-xs font-medium text-ink-soft flex-1 truncate">{z}</span>
            <span className="text-[11px] font-mono text-ink-faint">{counts[z]} nodes</span>
          </label>
        ))}
        {zones.length === 0 && (
          <p className="text-[11px] text-ink-faint">No neighborhoods loaded.</p>
        )}
      </div>

      {onApplyZones && (
        <div className="mt-3 pt-3 border-t border-[#E4E1D2]">
          <button
            onClick={handlePreset}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-full text-xs font-bold transition cursor-pointer ${
              confirmPreset
                ? 'bg-gold hover:bg-gold-200 text-[#10333D]'
                : 'bg-grape-100 hover:bg-grape-200 text-grape-600 border border-grape-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {confirmPreset ? 'Click again to overwrite zones with demo categories' : 'Load land-use demo categories'}
          </button>
          {confirmPreset ? (
            <p className="text-[10px] text-gold-600 mt-1.5">
              Replaces every zone with Residential / Commercial / Industrial / Mixed. You can still edit zones manually in the table above.
            </p>
          ) : (
            <p className="text-[10px] text-ink-faint mt-1.5">
              …or type categories (e.g. Residential) directly into the zone column above.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
