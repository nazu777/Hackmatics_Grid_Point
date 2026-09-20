import React, { useEffect, useMemo, useState } from 'react';
import { TrendingDown } from 'lucide-react';
import { Neighborhood, OptimizationConfig, TradeoffResult } from '../types';
import { getTradeoffCurve } from '../services/api';

interface Props {
  neighborhoods: Neighborhood[];
  config: OptimizationConfig;
  maxK?: number;
  onSelectK?: (k: number) => void;
}

/**
 * Phase D #10 — Infra-vs-delivery elbow (dedicated view).
 * Delivery-cost curve (falls with K) vs infra-cost line (rises with K) vs
 * combined total across K, with the cost-minimizing K annotated and a
 * plain-language "why" caption. Figures come from POST /api/scenarios/tradeoff
 * so they reconcile to the ComparisonDashboard cost engine row-for-row.
 */
export const TradeoffElbow: React.FC<Props> = ({ neighborhoods, config, maxK = 6, onSelectK }) => {
  const [curve, setCurve] = useState<TradeoffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!neighborhoods || neighborhoods.length === 0) {
      setCurve(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTradeoffCurve(neighborhoods, config, maxK)
      .then((res) => {
        if (!cancelled) setCurve(res);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || 'Trade-off unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neighborhoods, config.infra_cost_per_warehouse, config.cost_per_km, config.fuel_cost_per_km, config.distance_metric, maxK]);

  const whyCaption = useMemo(() => {
    if (!curve || curve.points.length === 0) return '';
    const pts = curve.points;
    const opt = pts.find((p) => p.K === curve.optimal_K) || pts[0];
    const first = pts[0];
    const deliveryDrop = first.delivery_cost - opt.delivery_cost;
    const infraAdded = opt.infra_cost - first.infra_cost;
    const next = pts.find((p) => p.K === curve.optimal_K + 1);
    const beyondNote = next
      ? ` Adding one more hub (K=${next.K}) would save only $${Math.max(0, opt.delivery_cost - next.delivery_cost).toLocaleString()} delivery while costing $${(next.infra_cost - opt.infra_cost).toLocaleString()} more infra — so total rises to $${next.total_cost.toLocaleString()}.`
      : ' Adding more hubs only adds infra from here — total rises.';
    return (
      `K=${opt.K} minimizes total at $${opt.total_cost.toLocaleString()}: ` +
      `splitting ${neighborhoods.length} nodes across ${opt.K} hub(s) cuts delivery ` +
      `$${first.delivery_cost.toLocaleString()} → $${opt.delivery_cost.toLocaleString()} ` +
      `(−$${Math.max(0, deliveryDrop).toLocaleString()}) for $${infraAdded.toLocaleString()} extra infra.` +
      beyondNote
    );
  }, [curve, neighborhoods.length]);

  if (!neighborhoods || neighborhoods.length === 0) {
    return (
      <div className="card p-5 text-xs text-ink-faint">
        Load neighborhood demand to see the infra-vs-delivery trade-off.
      </div>
    );
  }

  const W = 560;
  const H = 260;
  const PAD = { l: 56, r: 12, t: 14, b: 30 };
  const pts = curve?.points ?? [];
  const maxY = Math.max(1, ...pts.map((p) => Math.max(p.delivery_cost, p.infra_cost, p.total_cost)));
  const x = (k: number) => {
    const n = Math.max(1, pts.length - 1);
    const i = pts.findIndex((p) => p.K === k);
    return PAD.l + ((i < 0 ? 0 : i) / n) * (W - PAD.l - PAD.r);
  };
  const y = (v: number) => H - PAD.b - (v / maxY) * (H - PAD.t - PAD.b);
  const path = (pick: (p: (typeof pts)[number]) => number) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.K).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(' ');
  const optK = curve?.optimal_K;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-sm text-ink flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-[#14424E]" /> Infrastructure vs delivery trade-off
        </h3>
        {curve && (
          <span className="px-2.5 py-1 rounded-full bg-[#14424E] text-white text-xs font-extrabold">
            Min-K = {curve.optimal_K} · ${curve.min_cost.toLocaleString()}
          </span>
        )}
      </div>
      <p className="text-[11px] text-ink-faint mb-3">
        Delivery cost falls as hubs get closer to demand; infra cost rises per hub. The total (dark) bottoms out at the sweet spot.
      </p>

      {loading && <p className="text-xs text-ink-faint">Computing elbow across K…</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}

      {pts.length > 0 && (
        <>
          <div className="flex items-center gap-4 mb-2 text-[10px] font-semibold text-ink-faint uppercase tracking-wider">
            <span className="flex items-center gap-1"><span className="w-4 h-[3px] rounded bg-[#14424E] inline-block" /> Delivery</span>
            <span className="flex items-center gap-1"><span className="w-4 h-[3px] rounded bg-amber-500 inline-block" /> Infra</span>
            <span className="flex items-center gap-1"><span className="w-4 h-[3px] rounded bg-slate-900 inline-block" /> Total</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Infra vs delivery elbow chart">
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(maxY * f)} y2={y(maxY * f)} stroke="#E4E1D2" strokeWidth={1} />
                <text x={PAD.l - 6} y={y(maxY * f) + 3} textAnchor="end" fontSize={9} fill="#8a8778">
                  ${Math.round(maxY * f).toLocaleString()}
                </text>
              </g>
            ))}
            <path d={path((p) => p.delivery_cost)} fill="none" stroke="#14424E" strokeWidth={2.5} />
            <path d={path((p) => p.infra_cost)} fill="none" stroke="#f59e0b" strokeWidth={2.5} />
            <path d={path((p) => p.total_cost)} fill="none" stroke="#0f172a" strokeWidth={2.5} strokeDasharray="1 0" />
            {pts.map((p) => (
              <g key={p.K}>
                <circle cx={x(p.K)} cy={y(p.total_cost)} r={p.K === optK ? 6 : 3.5} fill={p.K === optK ? '#14424E' : '#fff'} stroke="#14424E" strokeWidth={2} />
                <text x={x(p.K)} y={H - 12} textAnchor="middle" fontSize={10} fontWeight={p.K === optK ? 800 : 500} fill="#3f3d33">
                  K={p.K}
                </text>
                {p.K === optK && (
                  <text x={Math.min(x(p.K) + 10, W - 120)} y={Math.max(y(p.total_cost) - 12, 12)} fontSize={11} fontWeight={800} fill="#14424E">
                    ★ min total
                  </text>
                )}
              </g>
            ))}
          </svg>
          <p className="text-[11px] text-ink-soft mt-2 leading-relaxed bg-cream-deep/70 border border-[#E4E1D2] rounded-xl p-3">
            <span className="font-bold text-ink">Why K={optK}? </span>{whyCaption}
          </p>
          {onSelectK && curve && (
            <button
              onClick={() => onSelectK(curve.optimal_K)}
              className="mt-3 px-4 py-2 bg-[#14424E] hover:bg-[#0d333d] text-white rounded-full text-xs font-bold transition cursor-pointer"
            >
              Set K = {curve.optimal_K}
            </button>
          )}
        </>
      )}
    </div>
  );
};
