import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Warehouse, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream text-ink flex flex-col">
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-[#14424E] flex items-center justify-center">
            <Warehouse className="w-5 h-5 text-white" />
          </span>
          <span className="font-display font-bold text-lg tracking-tight">GridPoint</span>
        </Link>
        <Link to="/" className="text-[13px] font-bold text-ink-soft hover:text-ink transition">
          ← Back to home
        </Link>
      </header>
      <main className="flex-1 flex items-start sm:items-center justify-center px-6 pb-12">
        <div className="w-full max-w-md card p-8">
          <h1 className="font-display font-bold text-[26px]">{title}</h1>
          <p className="text-[13px] text-ink-soft mt-1.5">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

const inputCls =
  'w-full px-4 py-2.5 rounded-xl bg-cream border border-[#E4E1D2] text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-grape-500/40 focus:border-grape-500 transition';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate('/app/ask', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Welcome back" subtitle="Log in to continue planning your warehouse network.">
      <form onSubmit={submit} className="space-y-3">
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address" className={inputCls} autoComplete="email"
        />
        <input
          type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" className={inputCls} autoComplete="current-password"
        />
        {error && (
          <div className="text-[13px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
            {error}
          </div>
        )}
        <button
          type="submit" disabled={busy}
          className="w-full py-3 rounded-full bg-[#14424E] text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Log in
        </button>
      </form>
      <p className="text-[13px] text-ink-soft mt-5 text-center">
        No account yet?{' '}
        <Link to="/signup" className="font-bold text-grape-600 hover:underline">Create one</Link>
      </p>
    </Shell>
  );
};

export const SignupPage: React.FC = () => {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    try {
      await signup(name.trim(), email.trim(), password);
      navigate('/app/ask', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Signup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Create your account" subtitle="Free to start — optimize your first network in minutes.">
      <form onSubmit={submit} className="space-y-3">
        <input
          type="text" required value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Full name" className={inputCls} autoComplete="name"
        />
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address" className={inputCls} autoComplete="email"
        />
        <input
          type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 8 characters)" className={inputCls} autoComplete="new-password"
        />
        {error && (
          <div className="text-[13px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
            {error}
          </div>
        )}
        <button
          type="submit" disabled={busy}
          className="w-full py-3 rounded-full bg-grape-500 text-white text-sm font-bold shadow-lg shadow-grape-500/30 hover:bg-grape-600 transition disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Create account
        </button>
      </form>
      <p className="text-[13px] text-ink-soft mt-5 text-center">
        Already have an account?{' '}
        <Link to="/login" className="font-bold text-grape-600 hover:underline">Log in</Link>
      </p>
    </Shell>
  );
};
