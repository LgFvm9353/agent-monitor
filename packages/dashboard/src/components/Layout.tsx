import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Search,
  BarChart3,
  Play,
  Activity,
} from 'lucide-react';

const navItems = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/trace', label: 'Trace Explorer', icon: Search },
  { to: '/eval', label: 'Eval', icon: BarChart3 },
  { to: '/playground', label: 'Playground', icon: Play },
  { to: '/monitor', label: 'Monitor', icon: Activity },
];

export function Layout() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border bg-card flex-shrink-0">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold text-primary flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Agent Harness
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Monitor &amp; Observe</p>
        </div>
        <nav className="p-2 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
