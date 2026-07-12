import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { OverviewPage } from './pages/overview/OverviewPage';
import { TraceExplorerPage } from './pages/trace/TraceExplorerPage';
import { PlaygroundPage } from './pages/playground/PlaygroundPage';
import { MonitorPage } from './pages/monitor/MonitorPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/trace" element={<TraceExplorerPage />} />
        <Route path="/trace/:traceId" element={<TraceExplorerPage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/monitor" element={<MonitorPage />} />
      </Route>
    </Routes>
  );
}
