import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { LoginPage } from './pages/Login';
import { GoalsPage } from './pages/Goals';
import { CanvasPage } from './pages/Canvas';
import { BoardStubPage } from './pages/BoardStub';

function Private({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <p className="muted" style={{ padding: 24 }}>Загрузка…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const { user, ready } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={ready && user ? <Navigate to="/goals" replace /> : <LoginPage />}
      />
      <Route
        path="/goals"
        element={
          <Private>
            <GoalsPage />
          </Private>
        }
      />
      <Route
        path="/goals/:goalId"
        element={
          <Private>
            <CanvasPage />
          </Private>
        }
      />
      <Route
        path="/goals/:goalId/nodes/:nodeId/board"
        element={
          <Private>
            <BoardStubPage />
          </Private>
        }
      />
      <Route path="*" element={<Navigate to={user ? '/goals' : '/login'} replace />} />
    </Routes>
  );
}
