import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, History, Loader2 } from 'lucide-react';
import type { Neighborhood, OptimizationConfig, OptimizationResult, ValidationResult, VehicleType, Warehouse } from '../types';
import { applyLandUsePreset, zoneCounts } from './mapThemes';
import { getRecents, pushRecent, searchNeighborhoods, downloadFile } from './panelStore';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  cta?: { label: string; onClick: () => void };
}

interface AskPanelProps {
  neighborhoods: Neighborhood[];
  vehicles: VehicleType[];
  warehouses: Warehouse[];
  config: OptimizationConfig;
  result: OptimizationResult | null;
  validation: ValidationResult;
  vehiclesValidation: ValidationResult;
  warehousesValidation: ValidationResult;
  onOptimize: (k: number) => Promise<OptimizationResult | null>;
  onOpenCompare: () => void;
  onApplyZones: (updated: Neighborhood[]) => void;
  onExportDataset: () => void;
  onExportComparison: () => void;
  onOpenDetail: (node: Neighborhood) => void;
  onShowResults: (nodes: Neighborhood[], title: string) => void;
  onOpenCensus: () => void;
  onOpenDataTab: (t: 'orders' | 'vehicles' | 'warehouses') => void;
  onOpenOverview: () => void;
}

const SUGGESTIONS = [
  'Optimize for 2 warehouses',
  'How much will I save?',
  'What data do I have?',
  'Where are my warehouses?',
  'Is my data valid?',
  'Show traffic congestion',
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

const num = (n: number | null | undefined) => (Number(n) || 0).toLocaleString();

function vehiclesCsv(rows: VehicleType[]): string {
  const header = 'vehicle_type,capacity,cost_per_km,fuel_type,avg_speed_kmph,mileage_kmpl';
  const lines = rows.map((v) =>
    [v.vehicle_type, v.capacity, v.cost_per_km, v.fuel_type || 'petrol', v.avg_speed_kmph ?? 30, v.mileage_kmpl ?? ''].join(',')
  );
  return [header, ...lines].join('\n');
}

function warehousesCsv(rows: Warehouse[]): string {
  const header = 'warehouse_id,latitude,longitude,capacity,radius_km,infra_cost';
  const lines = rows.map((w) =>
    [w.warehouse_id, w.latitude, w.longitude, w.capacity ?? '', w.radius_km ?? '', w.infra_cost ?? 0].join(',')
  );
  return [header, ...lines].join('\n');
}

export const AskPanel: React.FC<AskPanelProps> = ({
  neighborhoods,
  vehicles,
  warehouses,
  config,
  result,
  validation,
  vehiclesValidation,
  warehousesValidation,
  onOptimize,
  onOpenCompare,
  onApplyZones,
  onExportDataset,
  onExportComparison,
  onOpenDetail,
  onShowResults,
  onOpenCensus,
  onOpenDataTab,
  onOpenOverview
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

  const reportValidity = () => {
    const sets: { label: string; tab: 'orders' | 'vehicles' | 'warehouses'; v: ValidationResult }[] = [
      { label: 'orders', tab: 'orders', v: validation },
      { label: 'vehicles', tab: 'vehicles', v: vehiclesValidation },
      { label: 'warehouses', tab: 'warehouses', v: warehousesValidation }
    ];
    const problems = sets.flatMap((s) =>
      s.v.errors.filter((e) => e.code !== 'EMPTY_DATASET').map((e) => ({ ...e, set: s.label }))
    );
    if (neighborhoods.length === 0 && vehicles.length === 0 && warehouses.length === 0) {
      say('No data loaded yet — nothing to validate. Use the Data tab to import or generate orders, vehicles and warehouses.',
        { label: 'Open Data', onClick: () => onOpenDataTab('orders') });
      return;
    }
    if (problems.length === 0) {
      say('All loaded data is valid — orders, fleet and sites pass every check. Ready to optimize.');
      return;
    }
    const first = problems.slice(0, 3)
      .map((e) => `${e.set} row ${e.row ?? '?'} (${e.field}): ${e.error}`)
      .join('; ');
    const more = problems.length > 3 ? ` Plus ${problems.length - 3} more — see the tables.` : '';
    say(`${problems.length} issue${problems.length === 1 ? '' : 's'}: ${first}.${more}`,
      { label: 'Open Data', onClick: () => onOpenDataTab('orders') });
  };

  const reportWarehouses = () => {
    if (result && result.warehouses.length > 0) {
      const lines = result.warehouses.slice(0, 6).map((w) => {
        const m = result.metrics.warehouses.find((x) => x.warehouse_id === w.warehouse_id);
        const load = m ? `${num(m.assigned_orders)} orders${m.utilization_pct != null ? `, ${m.utilization_pct}% full` : ''}` : `${num(w.assigned_orders)} orders`;
        return `${w.warehouse_id} (${w.latitude.toFixed(3)}, ${w.longitude.toFixed(3)}) — ${load}`;
      });
      const extra = result.warehouses.length > 6 ? ` +${result.warehouses.length - 6} more` : '';
      const busy = [...result.metrics.warehouses].sort((a, b) => b.assigned_orders - a.assigned_orders)[0];
      say(`Optimized network has ${result.warehouses.length} warehouses: ${lines.join('; ')}${extra}. Busiest is ${busy.warehouse_id} (${num(busy.assigned_orders)} orders).`,
        { label: 'Open comparison', onClick: onOpenCompare });
      return;
    }
    if (warehouses.length > 0) {
      const lines = warehouses.slice(0, 6).map((w) =>
        `${w.warehouse_id} (${Number(w.latitude).toFixed(3)}, ${Number(w.longitude).toFixed(3)})${w.capacity ? `, cap ${num(w.capacity)}` : ''}`
      );
      const extra = warehouses.length > 6 ? ` +${warehouses.length - 6} more` : '';
      say(`You have ${warehouses.length} existing site${warehouses.length === 1 ? '' : 's'} (no optimized plan yet): ${lines.join('; ')}${extra}. Run the optimizer to place the optimal set.`,
        { label: 'Open Data', onClick: () => onOpenDataTab('warehouses') });
      return;
    }
    say('No warehouses yet — import existing sites or run the optimizer to place new ones.',
      { label: 'Open Data', onClick: () => onOpenDataTab('warehouses') });
  };

  const reportFleet = () => {
    if (vehicles.length === 0) {
      say('No vehicles in the fleet yet — import a fleet CSV or generate one in the Data tab.',
        { label: 'Open Data', onClick: () => onOpenDataTab('vehicles') });
      return;
    }
    const lines = vehicles.slice(0, 6).map((v) =>
      `${v.vehicle_type} (cap ${num(v.capacity)}, ₹${v.cost_per_km}/km, ${v.fuel_type || 'petrol'})`
    );
    const extra = vehicles.length > 6 ? ` +${vehicles.length - 6} more` : '';
    say(`Fleet has ${vehicles.length} type${vehicles.length === 1 ? '' : 's'}: ${lines.join('; ')}${extra}. Fleet costs feed the optimizer and ETA math.`,
      { label: 'Open Data', onClick: () => onOpenDataTab('vehicles') });
  };

  const reportInventory = () => {
    if (neighborhoods.length === 0 && vehicles.length === 0 && warehouses.length === 0) {
      say('Your workspace is empty — no orders, vehicles or warehouses yet. Import a file or generate data in the Data tab.',
        { label: 'Open Data', onClick: () => onOpenDataTab('orders') });
      return;
    }
    say(`${num(neighborhoods.length)} order nodes (${num(totalOrders)} daily orders), ${num(vehicles.length)} vehicle types, ${num(warehouses.length)} existing sites${result ? `, plus an optimized plan with ${result.warehouses.length} warehouses` : ' and no optimized plan yet'}.`,
      { label: 'Open Data', onClick: () => onOpenDataTab('orders') });
  };

  const reportFuel = () => {
    if (result) {
      const live = result.metrics.fuel_live ? 'live prices' : 'manual rates';
      say(`Fuel is ₹${num(result.metrics.total_fuel_cost ?? 0)} of ₹${num(result.metrics.total_cost)} total (${live}).${result.fuel_note ? ` ${result.fuel_note}` : ''}`);
      return;
    }
    const rate = config.fuel_cost_per_km > 0
      ? `Manual rate is ₹${config.fuel_cost_per_km}/km·order.`
      : 'No fuel rate set yet.';
    say(`${rate} Turn on live fuel (or set a rate) in Optimize, then run it for per-route fuel truth.${config.use_live_fuel ? ' Live fuel is ON.' : ''}`);
  };

  const reportFeasibility = () => {
    if (result) {
      if (result.is_feasible) {
        say(`Plan is feasible — ${result.metrics.feasibility_ratio * 100}% of assignments within limits, ${result.metrics.infeasible_assignments} violations.`);
      } else {
        say(`Plan has ${result.metrics.infeasible_assignments} violation${result.metrics.infeasible_assignments === 1 ? '' : 's'} (feasibility ${(result.metrics.feasibility_ratio * 100).toFixed(1)}%). ${result.infeasibility_reason || ''} Loosen capacity/radius in Optimize or add warehouses.`);
      }
      return;
    }
    const bits = [
      config.capacity_enabled ? `capacity C_max=${config.C_max}` : 'capacity off',
      config.radius_enabled ? `radius R_max=${config.R_max_km} km` : 'radius off'
    ];
    say(`No plan yet — nothing to check. Current constraints: ${bits.join(', ')}. Set them in Optimize, then run.`);
  };

  const reportOverview = () => {
    if (result) {
      const d = result.comparison?.delta;
      say(`${result.warehouses.length} warehouses serve ${num(neighborhoods.length)} nodes (${num(totalOrders)} orders/day) for ₹${num(result.metrics.total_cost)}${d ? ` — ${d.pct_cost_saved}% cheaper than baseline` : ''}.`,
        { label: 'Open Overview', onClick: onOpenOverview });
      return;
    }
    say(`No optimized plan yet — ${num(neighborhoods.length)} nodes with ${num(totalOrders)} daily orders loaded. The Overview tab rolls up vehicles, fuel, infra and costs once you optimize.`,
      { label: 'Open Overview', onClick: onOpenOverview });
  };

  const handleAsk = async (raw: string) => {
    const q = raw.trim();
    if (!q || busy) return;
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setInput('');
    pushRecent(q);
    setRecents(getRecents());
    const lower = q.toLowerCase();

    // 1. Help / website how-to (entity questions fall through to their topics).
    const mentionsEntity = /(warehouse|vehicle|fleet|order|demand|traffic|neighborhood|zone|site|fuel|cost|radius|r_max|c_max|capacity|\bk\b)/.test(lower);
    if (/(^help\b|what can you do|capabilit|commands)/.test(lower) ||
      (/(how (do|can|to)|how does|where (is|are|do|can)|what (is|does)|tell me|explain|guide|tutorial|getting started|how it works)/.test(lower) && !mentionsEntity)) {
      if (/(import|upload|add|generat|synthetic|sample|seed|data)/.test(lower)) {
        say('Add data in the Data tab: pick Orders, Vehicles or Warehouses, hit Import, then either drop a CSV/JSON file or use Generate data. Fresh accounts start empty; the Hyderabad sample and US Census seeder are one click.',
          { label: 'Open Data', onClick: () => onOpenDataTab('orders') });
      } else if (/(export|download)/.test(lower)) {
        say('Export from the Data tab (per-table Export button, CSV or JSON) or the Export tab (comparisons, assignments, map snapshots). The Ask box can also export: try "export vehicles".');
      } else if (/optimi/.test(lower)) {
        say('Set K, distance metric, capacity/radius limits, fuel and traffic in the Optimize tab, then Run. K=1 uses the Weiszfeld median, K>1 weighted K-means (or PuLP MILP with capacity). Results land in Compare.');
      } else {
        say('I can: run optimization ("optimize for 3 warehouses"), report savings, traffic, fuel and feasibility ("is my plan feasible?"), describe your data ("what data do I have?", "where are my warehouses?", "which warehouse serves N004?"), import/export ("export vehicles"), and find places ("Hitec"). Tabs: Ask, Saved, Optimize, Compare, Data, Lab, Overview, Export, Settings.');
      }
      return;
    }

    // 2. Add-data guidance (import / upload / generate / sample).
    const cityMention = CENSUS_CITY_WORDS.some(([re]) => re.test(lower));
    if (/(generat|synthetic|import|upload|sample|hyderabad|demo data)/.test(lower) ||
      (/\bseed\b/.test(lower) && !cityMention && !/census/.test(lower))) {
      say('Head to the Data tab: choose Orders, Vehicles or Warehouses, hit Import, then drop a CSV/JSON on Upload file or tune the Generate data form (city presets, counts, seed). US Census cities and the Hyderabad sample are there too.',
        { label: 'Open Data', onClick: () => onOpenDataTab('orders') });
      return;
    }

    // 3. Optimize command (tight shape only — questions fall through to help).
    const optK = lower.match(/(?:optimi[sz]e?|k)\s*(?:for|with|using|=|:)?\s*(\d+)/);
    const looksLikeOptimizeCmd =
      /\boptimi[sz]e?\s+(for|with|using)\b/.test(lower) ||
      /^(optimi[sz]e|run|place|find)\b/.test(lower.trim()) ||
      /\b(run|place|find)\b.*\b(warehouses?|optimiz\w*)\b/.test(lower) ||
      /\bk\s*=\s*\d+/.test(lower);
    if (looksLikeOptimizeCmd) {
      const k = optK?.[1] ? Math.max(1, Math.min(10, parseInt(optK[1], 10))) : config.K;
      if (neighborhoods.length === 0) {
        say('No demand data loaded yet — add data in the Data tab first.',
          { label: 'Open Data', onClick: () => onOpenDataTab('orders') });
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

    // 4. Savings question
    if (/(sav(e|ings?)|cheaper|save|cost reduction)/.test(lower)) {
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

    // 5. Data validity
    if (/(valid|error|issue|problem|wrong|missing|quality|fix|check)/.test(lower) && /(data|dataset|row|table|order|vehicle|warehouse|site)/.test(lower)) {
      reportValidity();
      return;
    }

    // 6. Export (dataset / comparison / fleet / sites) — before the topic
    // intents so "export vehicles" downloads instead of describing the fleet.
    if (/(export|download|csv|json)/.test(lower)) {
      if (/(vehicle|fleet)/.test(lower)) {
        if (vehicles.length === 0) {
          say('No vehicles to export yet.',
            { label: 'Open Data', onClick: () => onOpenDataTab('vehicles') });
        } else {
          downloadFile('gridpoint_vehicles.csv', vehiclesCsv(vehicles));
          say(`Fleet CSV downloaded (${vehicles.length} types). JSON is in the Data tab Export window.`);
        }
      } else if (/(warehouse|site)/.test(lower)) {
        if (warehouses.length === 0) {
          say('No warehouses to export yet.',
            { label: 'Open Data', onClick: () => onOpenDataTab('warehouses') });
        } else {
          downloadFile('gridpoint_warehouses.csv', warehousesCsv(warehouses));
          say(`Sites CSV downloaded (${warehouses.length} rows). JSON is in the Data tab Export window.`);
        }
      } else if (result?.comparison) {
        onExportComparison();
        say('Comparison CSV downloaded (baseline vs optimized + warehouse loads).');
      } else {
        onExportDataset();
        say('Dataset CSV downloaded. Run the optimizer to unlock the comparison export.');
      }
      return;
    }

    // 7. Assignment lookup ("which warehouse serves N004?") — falls through when nothing matches.
    if (/(serves|serving|serve|assigned?|belongs? to|which warehouse|who serves|how far is|distance of|distance to|lookup|find)\b/.test(lower)) {
      const rest = lower
        .replace(/(which|who|what|the|warehouse|warehouses|serves|serving|serve|assigned?|belongs?|to|is|are|for|of|how|far|distance|lookup|find|my|node|id|\?)/g, ' ')
        .trim();
      if (rest) {
        const hits = searchNeighborhoods(neighborhoods, rest);
        if (hits.length === 1) {
          const n = hits[0];
          const a = result?.assignments.find((x) => x.neighborhood_id === n.neighborhood_id);
          onOpenDetail(n);
          if (a) {
            const feas = a.is_feasible ? 'feasible' : 'radius exceeded';
            say(`${n.neighborhood_id} (${num(n.daily_orders)} orders/day) is served by ${a.warehouse_id} — ${a.distance_km} km, cost $${a.cost.toFixed(2)} (${feas}). Opened its details.`);
          } else {
            say(`${n.neighborhood_id} (${num(n.daily_orders)} orders/day) has no assignment yet — run the optimizer first. Opened its details.`);
          }
          return;
        }
        if (hits.length > 1) {
          onShowResults(hits.slice(0, 20), `${hits.length} matches for "${rest}"`);
          say(`${hits.length} places match — listed in the panel. Tap one for its serving warehouse.`);
          return;
        }
      }
      // No identifiable place: continue to the topic intents below.
    }

    // 8. Warehouses
    if (/(warehouse|warehouses|facilit|hubs?|utili[sz]ation|\bsites?\b)/.test(lower)) {
      reportWarehouses();
      return;
    }

    // 9. Fleet
    if (/(vehicle|fleet|trucks?|\bvans?\b|ev.?van|bikes?|capacity|speed|mileage)/.test(lower) && !/fuel (cost|price|rate)/.test(lower)) {
      reportFleet();
      return;
    }

    // 10. Fuel
    if (/(fuel|petrol|diesel|cng|autogas|electric|₹)/.test(lower)) {
      reportFuel();
      return;
    }

    // 11. Feasibility / constraints
    if (/(feasib|violation|breach|radius|r_max|constraint|infeasible|exceed|within limits)/.test(lower)) {
      reportFeasibility();
      return;
    }

    // 12. Overview / rollup
    if (/(overview|dashboard|results? summary|summary of (the |my )?(results?|network|plan)|report)/.test(lower)) {
      reportOverview();
      return;
    }

    // 13. Data inventory
    if (/(how many|total|my data|dataset|what data|inventory|loaded|where.*\b(data|orders?)\b)/.test(lower)) {
      reportInventory();
      return;
    }

    // 14. Biggest demand nodes
    if (/(biggest|top|largest|demand)/.test(lower)) {
      const top = [...neighborhoods].sort((a, b) => Number(b.daily_orders) - Number(a.daily_orders)).slice(0, 5);
      if (top.length === 0) {
        say('No demand data loaded yet.',
          { label: 'Open Data', onClick: () => onOpenDataTab('orders') });
        return;
      }
      onShowResults(top, 'Biggest demand nodes');
      say(`Top ${top.length} by daily orders — listed in the panel. Tap any row for details.`);
      return;
    }

    // 15. Traffic congestion report
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

    // 16. US Census seeding ("seed New York", "load Chicago demand", ...)
    if (/(census|real demand)/.test(lower) || CENSUS_CITY_WORDS.some(([re]) => re.test(lower))) {
      say('Opening the US Census seeder — pick a city to load real tract-level demand, then optimize on it.',
        { label: 'Seed US city', onClick: onOpenCensus });
      onOpenCensus();
      return;
    }

    // 17. Land-use demo preset
    if (/(demo|land.?use|residential|commercial|categor)/.test(lower)) {
      const updated = applyLandUsePreset(neighborhoods);
      const counts = zoneCounts(updated);
      onApplyZones(updated);
      say(
        `Applied land-use categories: ${Object.entries(counts).map(([z, c]) => `${z} (${c})`).join(', ')}. Recolor them anytime in the zone theme editor.`
      );
      return;
    }

    // 18. Fallback: neighborhood search (Ask Maps style)
    const hits = searchNeighborhoods(neighborhoods, q);
    if (hits.length === 0) {
      say(`No neighborhood matches "${q}". Try an id (N004), a name (Hitec), or a zone — or ask "what can you do?".`);
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
          <Sparkles className="w-3 h-3" /> Ask GridPoint — data, warehouses, savings, traffic & exports
        </p>
      </div>
    </div>
  );
};
