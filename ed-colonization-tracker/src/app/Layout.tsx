import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAppStore } from '@/store';
import { startJournalWatcher, isWatcherRunning } from '@/services/journalWatcher';
import { getJournalFolderHandle } from '@/services/journalReader';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '\u25C6' },
  { to: '/domain', label: "Architect's Domain", icon: '\u{1F3DB}\u{FE0F}' },
  { to: '/map', label: 'Colony Map', icon: '\u{1F30C}' },
  { to: '/system-view', label: 'System View', icon: '\u{2604}\u{FE0F}' },
  { to: '/projects', label: 'Projects', icon: '\u25A3' },
  { to: '/fleet-carrier', label: 'Fleet Carrier', icon: '\u2693' },
  { to: '/scouting', label: 'Expansion', icon: '\u{1F52D}' },
  { to: '/planner', label: 'Planner', icon: '\u{1F5FA}\u{FE0F}' },
  { to: '/sources', label: 'Sources', icon: '\u2605' },
  { to: '/sessions', label: 'Sessions', icon: '\u25F7' },
  { to: '/companion', label: 'Companion', icon: '\u{1F4E1}' },
  { to: '/journal-stats', label: 'Journal Stats', icon: '\u{1F4D6}' },
  { to: '/settings', label: 'Settings', icon: '\u2699' },
  { to: '/faq', label: 'FAQ & Help', icon: '\u2753' },
];

// Note: Systems are accessed via /systems/:systemName from the Dashboard
// No top-level nav link needed since they're contextual per-system pages

export function Layout() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  // Auto-start journal watcher on app load if journal folder is available
  useEffect(() => {
    if (!isWatcherRunning() && getJournalFolderHandle()) {
      startJournalWatcher();
    }
  }, []);
  const location = useLocation();
  // Full-width pages that shouldn't be constrained by max-w
  const fullWidthPages = ['/map', '/domain'];
  const isFullWidth = fullWidthPages.some((p) => location.pathname === p);
  const hideNav = location.pathname === '/system-view';
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar — hidden on system view page */}
      <nav className={`w-56 shrink-0 border-r border-border bg-card flex flex-col ${hideNav ? 'hidden' : ''}`}>
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold text-primary tracking-wide">
            ED Colony Tracker
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Colonization Progress</p>
        </div>
        <div className="flex-1 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary border-r-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
              {activeSessionId && item.to === '/sessions' && (
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse ml-auto" />
              )}
            </NavLink>
          ))}
        </div>
        <div className="p-4 border-t border-border text-xs text-muted-foreground">
          v1.0.0
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className={`${isFullWidth || hideNav ? '' : 'max-w-7xl'} mx-auto ${hideNav ? 'p-0' : 'p-6'}`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
