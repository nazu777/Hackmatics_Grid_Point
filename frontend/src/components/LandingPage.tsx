import React from 'react';
import { Link } from 'react-router-dom';
import { Warehouse, Sparkles, Scale, Package, ArrowRight, MapPin, Route, IndianRupee } from 'lucide-react';

const FEATURES = [
  {
    icon: Sparkles,
    title: 'Optimal warehouse placement',
    desc: 'Weiszfeld for a single hub, weighted K-Means for networks, MILP when capacity and radius constraints bite.'
  },
  {
    icon: Route,
    title: 'Neighborhood assignment',
    desc: 'Every demand node is assigned to its cheapest feasible warehouse — routes drawn live on the map.'
  },
  {
    icon: Scale,
    title: 'Cost comparison',
    desc: 'Baseline vs optimized delivery cost, distance saved, and per-warehouse utilization in one dashboard.'
  },
  {
    icon: Package,
    title: 'Real demand data',
    desc: 'Upload CSV/JSON, validate against the schema, or generate seedable synthetic cities for demos.'
  }
];

const STEPS = [
  { n: '01', t: 'Load demand', d: 'Upload neighborhoods or generate a synthetic city.' },
  { n: '02', t: 'Optimize', d: 'Pick K, distance metric, capacity and radius limits.' },
  { n: '03', t: 'Compare & export', d: 'Inspect savings, per-warehouse loads, and export CSVs.' }
];

export const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-cream text-ink">
      {/* Nav */}
      <header className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-[#14424E] flex items-center justify-center">
            <Warehouse className="w-5 h-5 text-white" />
          </span>
          <span className="font-display font-bold text-lg tracking-tight">GridPoint</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link
            to="/login"
            className="px-4 py-2 rounded-full text-[13px] font-bold text-ink hover:bg-cream-deep transition"
          >
            Log in
          </Link>
          <Link
            to="/signup"
            className="px-5 py-2.5 rounded-full bg-[#14424E] text-white text-[13px] font-bold hover:opacity-90 transition flex items-center gap-1.5"
          >
            Get started <ArrowRight className="w-4 h-4" />
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <main className="max-w-6xl mx-auto px-6">
        <section className="text-center pt-10 pb-12">
          <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white border border-[#E4E1D2] text-[11px] font-bold text-ink-soft shadow-sm mb-6">
            <MapPin className="w-3.5 h-3.5" /> E-commerce delivery optimization
          </div>
          <h1 className="font-display font-bold text-[42px] sm:text-[56px] leading-[1.05] tracking-tight max-w-3xl mx-auto">
            Where should the <span className="text-grape-600">warehouse</span> go?
          </h1>
          <p className="mt-5 text-[15px] sm:text-base text-ink-soft max-w-2xl mx-auto leading-relaxed">
            GridPoint minimizes <span className="font-mono text-[13px] bg-white border border-[#E4E1D2] rounded px-1.5 py-0.5">Σ w<sub>i</sub> · d(n<sub>i</sub>, w)</span> —
            place warehouses where demand actually is, assign every neighborhood
            optimally, and prove the savings.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
            <Link
              to="/signup"
              className="px-7 py-3.5 rounded-full bg-grape-500 text-white text-sm font-bold shadow-lg shadow-grape-500/30 hover:bg-grape-600 transition flex items-center gap-2"
            >
              Start optimizing <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/login"
              className="px-7 py-3.5 rounded-full bg-white border border-[#E4E1D2] text-sm font-bold hover:bg-cream-deep transition"
            >
              Log in
            </Link>
          </div>
          <div className="mt-6 flex items-center justify-center gap-5 text-[12px] text-ink-faint font-semibold flex-wrap">
            <span className="flex items-center gap-1.5"><IndianRupee className="w-3.5 h-3.5" /> Cost in INR / km</span>
            <span>•</span>
            <span>Seeded & reproducible</span>
            <span>•</span>
            <span>N=1000 in under 5s</span>
          </div>
        </section>

        {/* Pipeline strip */}
        <section className="grid sm:grid-cols-3 gap-3 pb-4">
          {STEPS.map((s) => (
            <div key={s.n} className="card p-5 text-left">
              <div className="font-display font-bold text-[26px] text-grape-500">{s.n}</div>
              <h3 className="font-bold text-sm mt-1">{s.t}</h3>
              <p className="text-[13px] text-ink-soft mt-1">{s.d}</p>
            </div>
          ))}
        </section>

        {/* Features */}
        <section className="py-8">
          <h2 className="font-display font-semibold text-[26px] text-center">Everything in the planning loop</h2>
          <p className="text-center text-[13px] text-ink-soft mt-2">Neighborhoods → map → optimization → assignment → cost comparison</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="card p-5">
                  <span className="w-10 h-10 rounded-2xl bg-cream-deep flex items-center justify-center">
                    <Icon className="w-5 h-5 text-[#14424E]" />
                  </span>
                  <h3 className="font-bold text-sm mt-3">{f.title}</h3>
                  <p className="text-[12.5px] text-ink-soft mt-1.5 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* CTA */}
        <section className="pb-14">
          <div className="rounded-3xl bg-[#14424E] text-white p-8 sm:p-12 text-center relative overflow-hidden">
            <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-grape-500/20 blur-2xl" />
            <div className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-gold/10 blur-2xl" />
            <h2 className="font-display font-bold text-[28px] sm:text-[34px] relative">Plan your network in minutes</h2>
            <p className="text-white/70 text-sm mt-3 max-w-xl mx-auto relative">
              Create a free account, load your demand data, and let GridPoint find
              the cheapest feasible warehouse layout.
            </p>
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 mt-6 px-8 py-3.5 rounded-full bg-grape-300 text-[#10333D] text-sm font-bold hover:bg-grape-200 transition relative"
            >
              Create free account <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E4E1D2] py-6 text-center text-[12px] text-ink-faint">
        GridPoint — warehouse location & assignment optimization • Built for Hackmatics
      </footer>
    </div>
  );
};
