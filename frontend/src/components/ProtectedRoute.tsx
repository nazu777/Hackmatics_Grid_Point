import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { user, token, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-cream text-ink">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#14424E] flex items-center justify-center animate-pulse">
            <span className="text-white font-bold text-sm">GP</span>
          </div>
          <p className="text-[13px] font-semibold text-ink-soft">Checking session…</p>
        </div>
      </div>
    );
  }

  if (!user || !token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
};
