import React, { useState } from 'react';
import { ChevronLeft, Crosshair, Users, Download, Copy, Check } from 'lucide-react';
import type { Assignment, Neighborhood } from '../types';
import { copyText, downloadFile, nearestTo } from './panelStore';
import { colorForZone } from './mapThemes';

interface DetailCardProps {
  node: Neighborhood;
  /** Full dataset — used for Nearby ranking. */
  allNodes: Neighborhood[];
  assignment?: Assignment | null;
  demandRank?: number | null;
  onBack: () => void;
  onCenter: (node: Neighborhood) => void;
  onOpenDetail: (node: Neighborhood) => void;
  zoneColors: Record<string, string>;
}

type Tab = 'overview' | 'assignment' | 'about';

export const DetailCard: React.FC<DetailCardProps> = ({
  node,
  allNodes,
  assignment,
  demandRank,
  onBack,
  onCenter,
  onOpenDetail,
  zoneColors
}) => {
  const [tab, setTab] = useState<Tab>('overview');
  const [copied, setCopied] = useState(false);
  const [showNearby, setShowNearby] = useState(false);

  const nearby = nearestTo(allNodes, node.latitude, node.longitude, 3).filter(
    (x) => x.node.neighborhood_id !== node.neighborhood_id
  );

  const handleCopy = async () => {
    const ok = await copyText(JSON.stringify(node, null, 2));
    setCopied(ok);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleExportRow = () => {
    const header = 'neighborhood_id,name,latitude,longitude,daily_orders,zone';
    const row = [node.neighborhood_id, `"${node.name || ''}"`, node.latitude, node.longitude, node.daily_orders, `"${node.zone || ''}"`].join(',');
    downloadFile(`${node.neighborhood_id}.csv`, `${header}\n${row}`);
  };

  const zone = (node.zone || 'Unzoned').trim() || 'Unzoned';

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs font-semibold text-ink-soft hover:text-ink transition cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
      </div>

      <div className="px-5 pt-2 overflow-y-auto nice-scroll flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display font-semibold text-[24px] text-ink leading-tight">{node.name || node.neighborhood_id}</h2>
            <p className="font-mono text-[11px] text-ink-faint mt-0.5">{node.neighborhood_id}</p>
          </div>
          <span
            className="text-[10px] font-bold px-2.5 py-1 rounded-full text-white shrink-0 mt-1"
            style={{ background: colorForZone(zone, zoneColors) }}
          >
            {zone}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-2 text-[13px]">
          <span className="font-bold text-ink">{Number(node.daily_orders).toLocaleString()}</span>
          <span className="text-ink-faint">daily orders</span>
          {demandRank != null && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gold-100 text-gold-600">
              #{demandRank} demand
            </span>
          )}
        </div>
        <p className="font-mono text-[11px] text-ink-faint mt-1">
          {Number(node.latitude).toFixed(5)}, {Number(node.longitude).toFixed(5)}
        </p>

        {/* Tabs */}
        <div className="flex gap-5 mt-4 border-b border-[#E4E1D2] text-[13px] font-semibold">
          {(['overview', 'assignment', 'about'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-2 capitalize transition cursor-pointer ${
                tab === t ? 'text-ink border-b-2 border-ink -mb-px' : 'text-ink-faint hover:text-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="py-3 space-y-2 text-[13px]">
            {[
              ['Daily orders (wᵢ)', Number(node.daily_orders).toLocaleString()],
              ['Zone / category', zone],
              ['Latitude', Number(node.latitude).toFixed(6)],
              ['Longitude', Number(node.longitude).toFixed(6)]
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-ink-faint">{k}</span>
                <span className="font-semibold text-ink font-mono">{v}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'assignment' && (
          <div className="py-3 text-[13px]">
            {assignment ? (
              <div className="space-y-2">
                {[
                  ['Warehouse', assignment.warehouse_id],
                  ['Distance', `${assignment.distance_km} km`],
                  ['Weighted distance', `${assignment.weighted_distance.toLocaleString()} km·orders`],
                  ['Delivery cost', `$${assignment.cost.toLocaleString()}`],
                  ['Status', assignment.is_feasible ? 'Feasible' : 'Radius exceeded']
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-ink-faint">{k}</span>
                    <span className="font-semibold text-ink font-mono">{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-ink-faint">
                Not assigned yet — run the optimizer to attach this neighborhood to its optimal warehouse.
              </p>
            )}
          </div>
        )}

        {tab === 'about' && (
          <div className="py-3 text-[13px] text-ink-soft space-y-2">
            <p>
              Demand nodes carry a location plus a weight <span className="font-mono">wᵢ = daily_orders</span>.
              The optimizer minimizes <span className="font-mono">Σ wᵢ · d(nᵢ, w)</span> so high-order
              neighborhoods pull warehouses toward themselves.
            </p>
            <p>Zones are free-form categories (e.g. Residential, Commercial) used for map themes.</p>
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-4 gap-1 py-3">
          {[
            { label: 'Center', icon: Crosshair, fn: () => onCenter(node) },
            { label: 'Nearby', icon: Users, fn: () => setShowNearby((s) => !s) },
            { label: 'Export', icon: Download, fn: handleExportRow },
            { label: copied ? 'Copied' : 'Copy', icon: copied ? Check : Copy, fn: handleCopy }
          ].map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.label}
                onClick={a.fn}
                className="flex flex-col items-center gap-1.5 py-2 rounded-2xl hover:bg-cream-deep transition cursor-pointer"
              >
                <span className="w-10 h-10 rounded-full bg-cream-deep flex items-center justify-center text-ink">
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <span className="text-[11px] font-semibold text-ink">{a.label}</span>
              </button>
            );
          })}
        </div>

        {showNearby && (
          <div className="pb-4">
            <h4 className="text-xs font-bold text-ink mb-2">Nearby neighborhoods</h4>
            <div className="space-y-1.5">
              {nearby.map(({ node: nb, km }) => (
                <button
                  key={nb.neighborhood_id}
                  onClick={() => onOpenDetail(nb)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-cream-deep hover:bg-gold-100 transition cursor-pointer text-left"
                >
                  <span>
                    <span className="block text-xs font-bold text-ink font-mono">{nb.neighborhood_id}</span>
                    <span className="block text-[11px] text-ink-faint">{nb.name} • {nb.daily_orders} orders</span>
                  </span>
                  <span className="text-[11px] font-mono text-ink-soft">{km.toFixed(1)} km</span>
                </button>
              ))}
              {nearby.length === 0 && <p className="text-xs text-ink-faint">No other nodes loaded.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
