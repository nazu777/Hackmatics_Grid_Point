import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Eye, EyeOff } from 'lucide-react';
import { Neighborhood, BasemapStyle, MapLayerOptions } from '../types';

interface MapVisualizerProps {
  neighborhoods: Neighborhood[];
  layerOptions: MapLayerOptions;
  setLayerOptions: React.Dispatch<React.SetStateAction<MapLayerOptions>>;
}

// Subcomponent to automatically fly to or fit bounds
const BoundsFitter: React.FC<{ bounds: L.LatLngBoundsExpression | null }> = ({ bounds }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
      } catch (e) {
        // Fallback
      }
    }
  }, [bounds, map]);
  return null;
};

export const MapVisualizer: React.FC<MapVisualizerProps> = ({
  neighborhoods,
  layerOptions,
  setLayerOptions,
}) => {
  // Compute demand statistics
  const { minOrders, maxOrders, totalOrders } = useMemo(() => {
    const orders = neighborhoods.map((n) => Number(n.daily_orders) || 0);
    return {
      minOrders: orders.length > 0 ? Math.min(...orders) : 0,
      maxOrders: orders.length > 0 ? Math.max(...orders) : 1,
      totalOrders: orders.reduce((sum, o) => sum + o, 0),
    };
  }, [neighborhoods]);

  // Compute LatLng bounds for MapContainer
  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    const validCoords = neighborhoods
      .filter((n) => n.latitude != null && n.longitude != null && !isNaN(n.latitude) && !isNaN(n.longitude))
      .map((n) => [n.latitude, n.longitude] as [number, number]);

    if (validCoords.length === 0) return null;
    return L.latLngBounds(validCoords);
  }, [neighborhoods]);

  // Default center
  const defaultCenter = useMemo<[number, number]>(() => {
    if (neighborhoods.length === 0) return [17.385044, 78.486671];
    const lats = neighborhoods.map((n) => Number(n.latitude) || 0);
    const lons = neighborhoods.map((n) => Number(n.longitude) || 0);
    return [
      lats.reduce((a, b) => a + b, 0) / lats.length,
      lons.reduce((a, b) => a + b, 0) / lons.length,
    ];
  }, [neighborhoods]);

  // Bubble color & radius calculations per cartographic standards
  const getBubbleProperties = (orders: number) => {
    const ratio = maxOrders <= minOrders ? 0.5 : Math.max(0, Math.min(1, (orders - minOrders) / (maxOrders - minOrders)));
    // Radius proportional to sqrt(demand) between 7px and 26px
    const radius = 7 + (26 - 7) * Math.sqrt(ratio);

    // Color gradient
    let color = '#10b981'; // Emerald
    let category = 'Low';
    if (ratio >= 0.66) {
      color = '#ef4444'; // Red/Crimson
      category = 'High';
    } else if (ratio >= 0.33) {
      color = '#f59e0b'; // Amber
      category = 'Medium';
    }

    return { radius, color, category, ratio };
  };

  // Basemap Tile URLs
  const basemapUrls: Record<BasemapStyle, { url: string; attribution: string }> = {
    osm: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
    },
    positron: {
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full relative">
      {/* Top Map Action Bar */}
      <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
            🗺️
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              Geographic Demand Map
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                Phase 2
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              {neighborhoods.length} demand nodes &bull; {totalOrders.toLocaleString()} total daily orders
            </p>
          </div>
        </div>

        {/* Map Style & Layer Toggles */}
        <div className="flex items-center space-x-2">
          {/* Basemap Switcher */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 text-xs">
            <button
              onClick={() => setLayerOptions((prev) => ({ ...prev, basemap: 'osm' }))}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                layerOptions.basemap === 'osm' ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Standard
            </button>
            <button
              onClick={() => setLayerOptions((prev) => ({ ...prev, basemap: 'positron' }))}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                layerOptions.basemap === 'positron' ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Light
            </button>
            <button
              onClick={() => setLayerOptions((prev) => ({ ...prev, basemap: 'dark' }))}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                layerOptions.basemap === 'dark' ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Dark
            </button>
          </div>

          {/* Demand Bubble Toggle */}
          <button
            onClick={() => setLayerOptions((prev) => ({ ...prev, showBubbles: !prev.showBubbles }))}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-xl text-xs font-medium border transition ${
              layerOptions.showBubbles
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {layerOptions.showBubbles ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>Bubbles</span>
          </button>
        </div>
      </div>

      {/* Main Map Canvas */}
      <div className="relative w-full h-[580px]">
        <MapContainer
          center={defaultCenter}
          zoom={11}
          scrollWheelZoom={true}
          style={{ width: '100%', height: '100%', zIndex: 10 }}
        >
          <TileLayer
            attribution={basemapUrls[layerOptions.basemap].attribution}
            url={basemapUrls[layerOptions.basemap].url}
          />

          <BoundsFitter bounds={bounds} />

          {/* Render Demand Circle Markers */}
          {layerOptions.showBubbles &&
            neighborhoods.map((n) => {
              if (n.latitude == null || n.longitude == null || isNaN(n.latitude) || isNaN(n.longitude)) {
                return null;
              }
              const { radius, color, category } = getBubbleProperties(n.daily_orders);

              return (
                <CircleMarker
                  key={n.neighborhood_id}
                  center={[n.latitude, n.longitude]}
                  radius={radius}
                  pathOptions={{
                    fillColor: color,
                    fillOpacity: 0.65,
                    color: '#ffffff',
                    weight: 2,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -radius]} opacity={0.95}>
                    <div className="text-xs font-sans">
                      <div className="font-bold text-slate-800">{n.name || n.neighborhood_id}</div>
                      <div className="text-slate-500">
                        Orders: <strong className="text-emerald-700">{n.daily_orders}</strong> ({category})
                      </div>
                    </div>
                  </Tooltip>

                  <Popup>
                    <div className="p-3 text-slate-800 font-sans min-w-[200px]">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          {n.neighborhood_id}
                        </span>
                        {n.zone && (
                          <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            {n.zone}
                          </span>
                        )}
                      </div>
                      <h4 className="font-bold text-sm text-slate-900 mb-1">{n.name || 'Neighborhood'}</h4>
                      <div className="space-y-1 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Daily Demand (w_i):</span>
                          <span className="font-bold text-slate-800">{n.daily_orders.toLocaleString()} orders</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Latitude:</span>
                          <span className="font-mono">{n.latitude.toFixed(6)}°</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Longitude:</span>
                          <span className="font-mono">{n.longitude.toFixed(6)}°</span>
                        </div>
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
        </MapContainer>

        {/* Floating Map Legend */}
        <div className="absolute bottom-4 left-4 z-[400] bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-2xl p-3 shadow-lg max-w-[220px]">
          <div className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Demand Intensity (Orders/Day)
          </div>
          <div className="space-y-1.5 text-[11px] text-slate-600">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#10b981] border border-white shadow-xs"></span>
                Low Demand
              </span>
              <span className="font-mono text-slate-400">{minOrders}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full bg-[#f59e0b] border border-white shadow-xs"></span>
                Medium Demand
              </span>
              <span className="font-mono text-slate-400">{Math.round((minOrders + maxOrders) / 2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-[#ef4444] border border-white shadow-xs"></span>
                High Demand
              </span>
              <span className="font-mono text-slate-400">{maxOrders}</span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400 flex items-center justify-between">
            <span>Bubble Radius ∝ √w_i</span>
            <span>Leaflet + OSM</span>
          </div>
        </div>
      </div>
    </div>
  );
};
