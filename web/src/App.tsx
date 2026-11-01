import { Navigate, Route, Routes } from 'react-router-dom';
import { GoalsPage } from './pages/Goals';
import { CanvasPage } from './pages/Canvas';
import { BoardPage } from './pages/Board';

export function App() {
  return (
    <Routes>
      <Route path="/goals" element={<GoalsPage />} />
      <Route path="/goals/:goalId" element={<CanvasPage />} />
      <Route path="/goals/:goalId/nodes/:nodeId/board" element={<BoardPage />} />
      <Route path="*" element={<Navigate to="/goals" replace />} />
    </Routes>
  );
}
