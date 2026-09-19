import { useState, useCallback } from 'react';
import type { BasemapStyle, Neighborhood, ZoneColorMap } from '../types';

/** Optional CARTO API key (Vite env). CARTO raster tiles now watermark without one — see https://carto.com/basemaps/apikey. */
function getCartoKey(): string {
  try {
    const env = import.meta.env as Record<string, string | undefined>;
    return env.VITE_CARTO_KEY || env.VITE_CARTO_API_KEY || '';
  } catch {
    return '';
  }
}

const CARTO_KEY = getCartoKey();

/** True when a CARTO key is configured (CARTO positron/dark styles used); false = keyless Esri grey fallbacks. */
export const CARTO_KEY_CONFIGURED = CARTO_KEY.length > 0;

/** Shared basemap registry — keyless by default (no watermark).
 * OSM Standard needs no key. Light/Dark use Esri grey canvases (no key) unless
 * VITE_CARTO_KEY / VITE_CARTO_API_KEY is set, in which case CARTO positron/dark_all are used with ?key=. */
export const BASEMAPS: Record<BasemapStyle, { url: string; attribution: string; label: string }> = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    label: 'Standard'
  },
  positron: CARTO_KEY
    ? {
        url: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        label: 'Light'
      }
    : {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ | &copy; OpenStreetMap contributors',
        label: 'Light'
      },
  dark: CARTO_KEY
    ? {
        url: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        label: 'Dark'
      }
    : {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ | &copy; OpenStreetMap contributors',
        label: 'Dark'
      }
};

/** Default land-use category colors (legend-ready). */
export const DEFAULT_ZONE_COLORS: ZoneColorMap = {
  Residential: '#10b981',
  Commercial: '#3b82f6',
  Industrial: '#f59e0b',
  Mixed: '#8b5cf6'
};

/** Fallback palette for zones without an explicit color (deterministic by hash). */
const FALLBACK_PALETTE = [
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
  '#14b8a6', '#eab308', '#ef4444', '#a855f7', '#0ea5e9'
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Resolve a zone's display color: custom map → defaults → deterministic fallback. */
export function colorForZone(zone: string | null | undefined, custom: ZoneColorMap = {}): string {
  const key = (zone || 'Unzoned').trim() || 'Unzoned';
  if (custom[key]) return custom[key];
  if (DEFAULT_ZONE_COLORS[key]) return DEFAULT_ZONE_COLORS[key];
  return FALLBACK_PALETTE[hashStr(key.toLowerCase()) % FALLBACK_PALETTE.length];
}

/** Distinct zone names in a dataset (normalized, sorted). */
export function distinctZones(neighborhoods: Neighborhood[]): string[] {
  const set = new Set<string>();
  neighborhoods.forEach((n) => {
    const z = (n.zone || 'Unzoned').trim() || 'Unzoned';
    set.add(z);
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Count nodes per zone. */
export function zoneCounts(neighborhoods: Neighborhood[]): Record<string, number> {
  const counts: Record<string, number> = {};
  neighborhoods.forEach((n) => {
    const z = (n.zone || 'Unzoned').trim() || 'Unzoned';
    counts[z] = (counts[z] || 0) + 1;
  });
  return counts;
}

const STORAGE_KEY = 'gridpoint_zone_colors';

/** localStorage-backed custom zone→color map. */
export function useZoneColors() {
  const [zoneColors, setZoneColorsState] = useState<ZoneColorMap>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved) as ZoneColorMap;
    } catch {
      /* ignore */
    }
    return {};
  });

  const setZoneColor = useCallback((zone: string, color: string) => {
    setZoneColorsState((prev) => {
      const next = { ...prev, [zone]: color };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetZoneColors = useCallback(() => {
    setZoneColorsState({});
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { zoneColors, setZoneColor, resetZoneColors };
}

const LAND_USE_CATEGORIES = ['Residential', 'Commercial', 'Industrial', 'Mixed'] as const;

/** Keyword rules mapping names/zones → land-use categories for the demo preset. */
function classifyLandUse(name: string, zone: string): string {
  const hay = `${name} ${zone}`.toLowerCase();
  if (/(hitec|hitech|cyber|gachibowli|madhapur|jubilee|banjara|begumpet|ameerpet|market|bazaar|charminar|mall|business|it |tech)/.test(hay)) {
    return 'Commercial';
  }
  if (/(industrial|estate|factory|pharma|cherlapally|jeedimetla|balanagar|sanathnagar)/.test(hay)) {
    return 'Industrial';
  }
  if (/(old city|kukatpally|secunderabad|dilsukhnagar|lb nagar|malakpet|hub)/.test(hay)) {
    return 'Mixed';
  }
  return 'Residential';
}

/**
 * Demo preset: remap every neighborhood's zone to a land-use category.
 * Deterministic — same input always yields the same categories.
 */
export function applyLandUsePreset(neighborhoods: Neighborhood[]): Neighborhood[] {
  return neighborhoods.map((n) => {
    const category = classifyLandUse(n.name || '', n.zone || '');
    return { ...n, zone: category };
  }).map((n, i, arr) => {
    // Spread minority categories so tiny demos still show variety:
    // if classifier yields <2 distinct values, round-robin the tail.
    const distinct = new Set(arr.map((x) => x.zone));
    if (distinct.size >= 2) return n;
    return { ...n, zone: LAND_USE_CATEGORIES[i % LAND_USE_CATEGORIES.length] };
  });
}
