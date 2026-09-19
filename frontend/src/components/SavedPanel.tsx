import React, { useState } from 'react';
import { Plus, Trash2, Flag, Star, Heart, Bookmark, FolderOpen, FlaskConical } from 'lucide-react';
import type { Neighborhood, OptimizationResult, ZoneColorMap } from '../types';
import { colorForZone, distinctZones, zoneCounts } from './mapThemes';
import {
  deleteList,
  deleteResult,
  getSavedLists,
  getSavedResults,
  saveList,
  saveResult
} from './panelStore';

interface SavedPanelProps {
  neighborhoods: Neighborhood[];
  result: OptimizationResult | null;
  zoneColors: ZoneColorMap;
  onLoadList: (nodes: Neighborhood[]) => void;
  onLoadResult: (result: OptimizationResult) => void;
}

type Tab = 'lists' | 'zones' | 'results';

const ZONE_ICONS = [Flag, Star, Heart, Bookmark, FolderOpen, FlaskConical];

export const SavedPanel: React.FC<SavedPanelProps> = ({
  neighborhoods,
  result,
  zoneColors,
  onLoadList,
  onLoadResult
}) => {
  const [tab, setTab] = useState<Tab>('lists');
  const [lists, setLists] = useState(() => getSavedLists());
  const [results, setResults] = useState(() => getSavedResults());
  const [naming, setNaming] = useState<'list' | 'result' | null>(null);
  const [name, setName] = useState('');

  const zones = distinctZones(neighborhoods);
  const counts = zoneCounts(neighborhoods);

  const commitName = () => {
    if (naming === 'list') {
      saveList(name, neighborhoods);
      setLists(getSavedLists());
    } else if (naming === 'result' && result) {
      saveResult(name, result);
      setResults(getSavedResults());
    }
    setNaming(null);
    setName('');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 flex items-center justify-between">
        <h2 className="font-display font-semibold text-[24px] text-ink">Saved</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 px-5 mt-1 border-b border-[#E4E1D2] text-[13px] font-semibold">
        {(['lists', 'zones', 'results'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 capitalize transition cursor-pointer ${
              tab === t ? 'text-ink border-b-2 border-ink -mb-px' : 'text-ink-faint hover:text-ink'
            }`}
          >
            {t === 'lists' ? 'Lists' : t === 'zones' ? 'Labeled' : 'Runs'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll p-4 space-y-2">
        {tab === 'lists' && (
          <>
            <button
              onClick={() => setNaming(naming === 'list' ? null : 'list')}
              className="w-full py-2.5 rounded-full bg-cream-deep text-ink text-[13px] font-bold hover:bg-gold-100 transition cursor-pointer flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> New list from current data
            </button>
            {naming === 'list' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  commitName();
                }}
                className="flex gap-2"
              >
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="List name"
                  className="flex-1 px-3 py-2 rounded-xl bg-white border border-[#E4E1D2] text-[13px] text-ink focus:outline-none focus:border-gold"
                />
                <button type="submit" className="px-4 py-2 rounded-xl bg-[#14424E] text-white text-xs font-bold cursor-pointer">
                  Save
                </button>
              </form>
            )}
            {lists.length === 0 && (
              <p className="text-xs text-ink-faint text-center py-6">No saved lists yet — snapshot the current dataset for later.</p>
            )}
            {lists.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-cream-deep transition"
              >
                <button onClick={() => onLoadList(l.neighborhoods)} className="flex items-center gap-3 flex-1 text-left cursor-pointer">
                  <Bookmark className="w-5 h-5 text-ink-soft shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-bold text-ink truncate">{l.name}</span>
                    <span className="block text-[11px] text-ink-faint">
                      {l.neighborhoods.length} places • {new Date(l.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => {
                    deleteList(l.id);
                    setLists(getSavedLists());
                  }}
                  title="Delete list"
                  className="text-ink-faint hover:text-red-600 transition cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </>
        )}

        {tab === 'zones' && (
          <>
            <p className="text-[11px] text-ink-faint px-1">Zone labels in the active dataset — tap to inspect nodes.</p>
            {zones.map((z, i) => {
              const Icon = ZONE_ICONS[i % ZONE_ICONS.length];
              return (
                <div key={z} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-cream-deep transition">
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0"
                    style={{ background: colorForZone(z, zoneColors) }}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-bold text-ink truncate">{z}</span>
                    <span className="block text-[11px] text-ink-faint">{counts[z]} places</span>
                  </span>
                </div>
              );
            })}
            {zones.length === 0 && <p className="text-xs text-ink-faint text-center py-6">No zones yet.</p>}
          </>
        )}

        {tab === 'results' && (
          <>
            <button
              onClick={() => result && setNaming(naming === 'result' ? null : 'result')}
              disabled={!result}
              className="w-full py-2.5 rounded-full bg-cream-deep text-ink text-[13px] font-bold hover:bg-gold-100 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Save current run
            </button>
            {naming === 'result' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  commitName();
                }}
                className="flex gap-2"
              >
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Run name"
                  className="flex-1 px-3 py-2 rounded-xl bg-white border border-[#E4E1D2] text-[13px] text-ink focus:outline-none focus:border-gold"
                />
                <button type="submit" className="px-4 py-2 rounded-xl bg-[#14424E] text-white text-xs font-bold cursor-pointer">
                  Save
                </button>
              </form>
            )}
            {results.length === 0 && (
              <p className="text-xs text-ink-faint text-center py-6">No saved runs yet — optimize first, then snapshot the result.</p>
            )}
            {results.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-cream-deep transition">
                <button onClick={() => onLoadResult(r.result)} className="flex-1 text-left cursor-pointer">
                  <span className="block text-[13px] font-bold text-ink truncate">{r.name}</span>
                  <span className="block text-[11px] text-ink-faint">
                    K={r.k} • {r.pctSaved}% saved • {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </button>
                <button
                  onClick={() => {
                    deleteResult(r.id);
                    setResults(getSavedResults());
                  }}
                  title="Delete run"
                  className="text-ink-faint hover:text-red-600 transition cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
