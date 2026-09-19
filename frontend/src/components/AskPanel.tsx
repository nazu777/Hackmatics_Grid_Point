import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, History, Loader2 } from 'lucide-react';
import type { Neighborhood, OptimizationConfig, OptimizationResult } from '../types';
import { applyLandUsePreset, zoneCounts } from './mapThemes';
import { getRecents, pushRecent, searchNeighborhoods } from './panelStore';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  cta?: { label: string; onClick: () => void };
}

interface AskPanelProps {
  neighborhoods: Neighborhood[];
  config: OptimizationConfig;
  result: OptimizationResult | null;
  onOptimize: (k: number) => Promise<OptimizationResult | null>;
  onOpenCompare: () => void;
  onApplyZones: (updated: Neighborhood[]) => void;
  onExportDataset: () => void;
  onExportComparison: () => void;
  onOpenDetail: (node: Neighborhood) => void;
  onShowResults: (nodes: Neighborhood[], title: string) => void;
  onOpenCensus: () => void;
}

const SUGGESTIONS = [
  'Optimize for 2 warehouses',
  'How much will I save?',
  'Show traffic congestion',
  'Seed New York demand',
  'Load land-use demo',
  'Show biggest demand nodes',
  'Export comparison CSV'
];

const CENSUS_CITY_WORDS: [RegExp, string][] = [
  [/new\s*york|nyc|manhattan|brooklyn|queens/i, ''],
  [/los\s*angeles|\bla\b|hollywood/i, ''],
  [/las\s*vegas|vegas/i, ''],
  [/chicago/i, ''],
  [/houston/i, ''],
  [/san\s*francisco|\bsf\b|bay area/i, '']
];

export const AskPanel: React.FC<AskPanelProps> = ({
  neighborhoods,
  config,
  result,
  onOptimize,
  onOpenCompare,
  onApplyZones,
  onExportDataset,
  onExportComparison,
  onOpenDetail,
  onShowResults,
  onOpenCensus
}) => {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<string[]>(() => getRecents());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  const say = (text: string, cta?: ChatMsg['cta']) =>
    setMessages((prev) => [...prev, { role: 'assistant', text, cta }]);

  const totalOrders = neighborhoods.reduce((s, n) => s + (Number(n.daily_orders) || 0), 0);

  const handleAsk = async (raw: string) => {
    const q = raw.trim();
    if (!q || busy) return;
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setInput('');
    pushRecent(q);
    setRecents(getRecents());
    const lower = q.toLowerCase();

    // 1. Optimize command
    const optMatch = lower.match(/optimi[sz]e?(?:\s*(?:with|for|using|k\s*=)?\s*(\d+))?/);
    if (optMatch && /(optimi[sz]|warehouse|k\s*=|run\b)/.test(lower)) {
      const k = optMatch[1] ? Math.max(1, Math.min(10, parseInt(optMatch[1], 10))) : config.K;
      if (neighborhoods.length === 0) {
        say('No demand data loaded yet — add neighborhoods in Demand Data first.');
        return;
      }
      setBusy(true);
      try {
        const res = await onOptimize(k);
        if (res?.comparison) {
          say(
            `Done — ${res.warehouses.length} warehouse${res.warehouses.length > 1 ? 's' : ''} placed. Weighted distance down ${res.comparison.delta.pct_distance_saved}%, delivery cost down ${res.comparison.delta.pct_cost_saved}% ($${res.comparison.delta.cost_saved.toLocaleString()} saved).`,
            { label: 'Open comparison', onClick: onOpenCompare }
          );
        } else if (res) {
          say(`Done — ${res.warehouses.length} warehouse${res.warehouses.length > 1 ? 's' : ''} placed.`);
        } else {
          say('Optimization failed — please try again.');
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    // 2. Savings question
    if (/(sav(e|ings?)|cheaper|save|cost)/.test(lower)) {
      if (result?.comparison) {
        const d = result.comparison.delta;
        say(
          `Current plan saves ${d.pct_cost_saved}% ($${d.cost_saved.toLocaleString()}) vs the baseline single-warehouse layout, and ${d.pct_distance_saved}% weighted distance.`,
          { label: 'Open comparison', onClick: onOpenCompare }
        );
      } else {
        say(`With ${neighborhoods.length} nodes and ${totalOrders.toLocaleString()} daily orders loaded, run the optimizer to measure savings. Try "optimize for 2 warehouses".`);
      }
      return;
    }

    // 3. Land-use demo preset
    if (/(demo|land.?use|residential|commercial|categor)/.test(lower)) {
      const updated = applyLandUsePreset(neighborhoods);
      const counts = zoneCounts(updated);
      onApplyZones(updated);
      say(
        `Applied land-use categories: ${Object.entries(counts).map(([z, c]) => `${z} (${c})`).join(', ')}. Recolor them anytime in the zone theme editor.`
      );
      return;
    }

    // 4. Export
    if (/(export|download|csv)/.test(lower)) {
      if (result?.comparison) {
        onExportComparison();
        say('Comparison CSV downloaded (baseline vs optimized + warehouse loads).');
      } else {
        onExportDataset();
        say('Dataset CSV downloaded. Run the optimizer to unlock the comparison export.');
      }
      return;
    }

    // 5. Biggest demand nodes
    if (/(biggest|top|largest|demand)/.test(lower)) {
      const top = [...neighborhoods].sort((a, b) => Number(b.daily_orders) - Number(a.daily_orders)).slice(0, 5);
      if (top.length === 0) {
        say('No demand data loaded yet.');
        return;
      }
      onShowResults(top, 'Biggest demand nodes');
      say(`Top ${top.length} by daily orders — listed in the panel. Tap any row for details.`);
      return;
    }

    // 6. Traffic congestion report
    if (/(traffic|congest|jam|speed)/.test(lower)) {
      if (result) {
        const pct = ((result.metrics.avg_congestion_pct ?? 0) * 100).toFixed(0);
        say(
          `Corridors are running +${pct}% over free-flow on average. ${result.traffic_note || ''} Toggle the Traffic chip on the map to see jammed routes in red.`,
          { label: 'Open comparison', onClick: onOpenCompare }
        );
      } else {
        say('No traffic data yet — run the optimizer with "Real-time speeds" on, and I will report live corridor congestion plus record it for future runs.');
      }
      return;
    }

    // 7. US Census seeding ("seed New York", "load Chicago demand", ...)
    if (/(seed|census|real demand)/.test(lower) || CENSUS_CITY_WORDS.some(([re]) => re.test(lower))) {
      say('Opening the US Census seeder — pick a city to load real tract-level demand, then optimize on it.',
        { label: 'Seed US city', onClick: onOpenCensus });
      onOpenCensus();
      return;
    }

    // 8. Help / capabilities
    if (/(help|what can|how (do|to)|commands?)/.test(lower)) {
      say('I can: run optimization ("optimize for 3 warehouses"), report savings ("how much will I save?"), report traffic ("show traffic congestion"), seed real US demand ("seed New York"), apply land-use categories, find neighborhoods ("Hitec"), list biggest demand nodes, and export CSVs.');
      return;
    }

    // 7. Fallback: neighborhood search (Ask Maps style)
    const hits = searchNeighborhoods(neighborhoods, q);
    if (hits.length === 0) {
      say(`No neighborhood matches "${q}". Try an id (N004), a name (Hitec), or a zone — or ask "help".`);
    } else if (hits.length === 1) {
      onOpenDetail(hits[0]);
      say(`Found ${hits[0].neighborhood_id} — opened its details.`);
    } else {
      onShowResults(hits.slice(0, 20), `${hits.length} matches for "${q}"`);
      say(`${hits.length} matches — listed in the panel. Tap any row for details.`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-3">
        <h2 className="font-display font-semibold text-[26px] text-ink leading-tight">
          Hi, Operator
        </h2>
        <p className="text-[15px] text-ink-soft mt-0.5">Where should the warehouse go?</p>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll px-5 space-y-3 pb-3">
        {recents.length > 0 && messages.length === 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-faint flex items-center gap-1.5 mb-2">
              <History className="w-3.5 h-3.5" /> Recents
            </p>
            <div className="flex flex-wrap gap-2">
              {recents.slice(0, 4).map((r) => (
                <button
                  key={r}
                  onClick={() => handleAsk(r)}
                  className="px-3 py-1.5 rounded-full bg-cream-deep text-ink text-xs font-medium hover:bg-gold-100 transition cursor-pointer max-w-full truncate"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.length === 0 && (
          <div className="grid grid-cols-1 gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleAsk(s)}
                className="text-left px-4 py-2.5 rounded-2xl bg-cream-deep text-ink text-[13px] font-medium hover:bg-gold-100 transition cursor-pointer"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={`max-w-[90%] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                m.role === 'user'
                  ? 'bg-[#14424E] text-white rounded-br-md'
                  : 'bg-cream-deep text-ink rounded-bl-md'
              }`}
            >
              <p>{m.text}</p>
              {m.cta && (
                <button
                  onClick={m.cta.onClick}
                  className="mt-2 px-3 py-1.5 rounded-full bg-gold text-[#10333D] text-xs font-bold hover:bg-gold-200 transition cursor-pointer"
                >
                  {m.cta.label}
                </button>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="px-4 py-2.5 rounded-2xl bg-cream-deep text-ink text-[13px] flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Crunching warehouses…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk(input);
          }}
          className="flex items-center gap-2 bg-white border border-[#E4E1D2] rounded-full pl-5 pr-2 py-2 shadow-sm focus-within:border-gold"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question"
            className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-9 h-9 rounded-full bg-cream-deep text-ink flex items-center justify-center hover:bg-gold-100 transition cursor-pointer disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[10px] text-ink-faint mt-2 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> Ask GridPoint — optimization, savings, search & exports
        </p>
      </div>
    </div>
  );
};
