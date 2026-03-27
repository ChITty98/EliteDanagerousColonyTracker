import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import { formatNumber, formatPercent, cleanProjectName } from '@/lib/utils';
import {
  computeSessionTons,
  computeSessionDurationMs,
  computeDeliveryRate,
  computeLiveTons,
  formatDuration,
  aggregateSessionStats,
  getProjectSessions,
  getCompletedSessions,
  computeProjectTotals,
  computeProjectedCompletion,
} from '@/lib/sessionUtils';
import type { PlaySession, ColonizationProject } from '@/store/types';

export function SessionsPage() {
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const stopSession = useAppStore((s) => s.stopSession);
  const updateSession = useAppStore((s) => s.updateSession);
  const deleteSession = useAppStore((s) => s.deleteSession);

  const [now, setNow] = useState(Date.now());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState<{ sessionId: string; field: 'start' | 'end' } | null>(null);

  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;
  const activeProject = activeSession ? projects.find((p) => p.id === activeSession.projectId) : null;

  // Tick timer every second when there's an active session
  useEffect(() => {
    if (!activeSessionId) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeSessionId]);

  // Aggregate stats across all completed sessions
  const completedSessions = useMemo(() => getCompletedSessions(sessions), [sessions]);
  const overallStats = useMemo(() => aggregateSessionStats(sessions), [sessions]);

  // Group sessions by project
  const sessionsByProject = useMemo(() => {
    const groups: { project: ColonizationProject; sessions: PlaySession[] }[] = [];
    const projectIds = new Set(sessions.map((s) => s.projectId));
    for (const pid of projectIds) {
      const project = projects.find((p) => p.id === pid);
      if (!project) continue;
      const projectSessions = getProjectSessions(sessions, pid).sort(
        (a, b) => Date.parse(b.startTime) - Date.parse(a.startTime)
      );
      groups.push({ project, sessions: projectSessions });
    }
    // Sort: active projects first, then by most recent session
    groups.sort((a, b) => {
      if (a.project.status === 'active' && b.project.status !== 'active') return -1;
      if (a.project.status !== 'active' && b.project.status === 'active') return 1;
      const aTime = Date.parse(a.sessions[0]?.startTime || '0');
      const bTime = Date.parse(b.sessions[0]?.startTime || '0');
      return bTime - aTime;
    });
    return groups;
  }, [sessions, projects]);

  // Active projects for progress dashboard
  const activeProjects = useMemo(() => {
    return projects
      .filter((p) => p.status === 'active')
      .map((p) => {
        const totals = computeProjectTotals(p);
        const pSessions = getProjectSessions(sessions, p.id);
        const stats = aggregateSessionStats(pSessions);
        const eta = computeProjectedCompletion(totals.totalRemaining, stats.avgRate);
        return { project: p, ...totals, ...stats, eta };
      })
      .sort((a, b) => b.progress - a.progress);
  }, [projects, sessions]);

  const toggleCollapse = (pid: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const handleSaveNotes = (sessionId: string) => {
    updateSession(sessionId, { notes: notesValue });
    setEditingNotes(null);
  };

  // Convert ISO string to datetime-local input value (YYYY-MM-DDTHH:MM)
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleSaveTime = (sessionId: string, field: 'start' | 'end', value: string) => {
    if (!value) { setEditingTime(null); return; }
    const iso = new Date(value).toISOString();
    if (field === 'start') {
      updateSession(sessionId, { startTime: iso });
    } else {
      updateSession(sessionId, { endTime: iso });
    }
    setEditingTime(null);
  };

  const handleDelete = (sessionId: string) => {
    deleteSession(sessionId);
    setConfirmDelete(null);
  };

  // Empty state
  if (sessions.length === 0 && !activeSessionId) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-6">Sessions & Progress</h2>
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <div className="text-4xl mb-3">{'\u25F7'}</div>
          <h3 className="font-semibold mb-2">No Sessions Yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            Start a delivery session from any active project's detail page to track your delivery rate over time.
          </p>
          <Link to="/projects" className="text-primary hover:underline text-sm">
            Go to Projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Sessions & Progress</h2>

      {/* Active session banner */}
      {activeSession && activeProject && (
        <div className="mb-6 bg-card border border-primary/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium">Active Session</span>
              <Link to={`/projects/${activeProject.id}`} className="text-sm text-primary hover:underline">
                {activeProject.name}
              </Link>
              <span className="text-lg font-mono font-bold text-primary">
                {formatDuration(now - Date.parse(activeSession.startTime))}
              </span>
            </div>
            <button
              onClick={stopSession}
              className="px-3 py-1.5 bg-destructive/20 text-destructive rounded-lg text-sm hover:bg-destructive/30 transition-colors"
            >
              Stop Session
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Tons Delivered</div>
              <div className="text-lg font-bold">
                {formatNumber(computeLiveTons(activeSession.startSnapshot, activeProject))}t
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Delivery Rate</div>
              <div className="text-lg font-bold">
                {(() => {
                  const tons = computeLiveTons(activeSession.startSnapshot, activeProject);
                  const ms = now - Date.parse(activeSession.startTime);
                  const rate = computeDeliveryRate(tons, ms);
                  return rate > 0 ? `${Math.round(rate)} t/hr` : '--';
                })()}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Started</div>
              <div className="text-sm font-medium">{new Date(activeSession.startTime).toLocaleTimeString()}</div>
            </div>
          </div>
        </div>
      )}

      {/* Summary stats */}
      {completedSessions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Total Sessions</div>
            <div className="text-xl font-bold">{overallStats.count}</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Total Time</div>
            <div className="text-xl font-bold">{formatDuration(overallStats.totalMs)}</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Tons Delivered</div>
            <div className="text-xl font-bold">{formatNumber(overallStats.totalTons)}t</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Avg Rate</div>
            <div className="text-xl font-bold">{overallStats.avgRate > 0 ? `${Math.round(overallStats.avgRate)} t/hr` : '--'}</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Best Rate</div>
            <div className="text-xl font-bold">{overallStats.bestRate > 0 ? `${Math.round(overallStats.bestRate)} t/hr` : '--'}</div>
          </div>
        </div>
      )}

      {/* Progress dashboard — active projects */}
      {activeProjects.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">Project Progress</h3>
          <div className="space-y-3">
            {activeProjects.map(({ project, totalRequired, totalProvided, totalRemaining, progress, avgRate, eta, count }) => (
              <div key={project.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <Link to={`/projects/${project.id}`} className="text-sm font-medium text-primary hover:underline">
                    {cleanProjectName(project.name)}
                  </Link>
                  <span className="text-xs text-muted-foreground">{project.systemName}</span>
                </div>
                <div className="flex items-center gap-4 mb-2">
                  <div className="flex-1">
                    <div className="w-full bg-muted rounded-full h-2.5">
                      <div
                        className="h-2.5 rounded-full transition-all"
                        style={{
                          width: `${Math.min(progress * 100, 100)}%`,
                          backgroundColor:
                            progress >= 1 ? 'var(--color-progress-complete)' :
                            progress >= 0.75 ? 'var(--color-progress-high)' :
                            progress >= 0.25 ? 'var(--color-progress-mid)' :
                            'var(--color-progress-low)',
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-bold min-w-[3rem] text-right">{formatPercent(progress)}</span>
                </div>
                <div className="flex items-center gap-6 text-xs text-muted-foreground">
                  <span>{formatNumber(totalProvided)}t / {formatNumber(totalRequired)}t</span>
                  <span>{formatNumber(totalRemaining)}t remaining</span>
                  {count > 0 && <span>Avg: {Math.round(avgRate)} t/hr</span>}
                  {eta && (
                    <span className="text-primary">
                      ETA: {eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session history grouped by project */}
      {sessionsByProject.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Session History</h3>
          <div className="space-y-4">
            {sessionsByProject.map(({ project, sessions: projSessions }) => {
              const isCollapsed = collapsedProjects.has(project.id);
              const projStats = aggregateSessionStats(projSessions);
              return (
                <div key={project.id} className="bg-card border border-border rounded-lg overflow-hidden">
                  {/* Group header */}
                  <button
                    onClick={() => toggleCollapse(project.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                  >
                    <span className="text-xs text-muted-foreground">{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                    <Link
                      to={`/projects/${project.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {cleanProjectName(project.name)}
                    </Link>
                    <span className="text-xs text-muted-foreground">({project.systemName})</span>
                    {project.status === 'completed' && (
                      <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">Completed</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {projStats.count} session{projStats.count !== 1 ? 's' : ''}
                      {projStats.totalTons > 0 && ` · ${formatNumber(projStats.totalTons)}t`}
                      {projStats.avgRate > 0 && ` · ${Math.round(projStats.avgRate)} t/hr avg`}
                    </span>
                  </button>

                  {/* Session rows */}
                  {!isCollapsed && (
                    <div className="border-t border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-muted-foreground border-b border-border">
                            <th className="px-4 py-2 text-left font-normal">Date</th>
                            <th className="px-4 py-2 text-right font-normal">Duration</th>
                            <th className="px-4 py-2 text-right font-normal">Tons</th>
                            <th className="px-4 py-2 text-right font-normal">Rate</th>
                            <th className="px-4 py-2 text-left font-normal">Notes</th>
                            <th className="px-4 py-2 text-right font-normal w-20"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {projSessions.map((session) => {
                            const isActive = session.id === activeSessionId;
                            const tons = isActive
                              ? computeLiveTons(session.startSnapshot, project)
                              : computeSessionTons(session);
                            const ms = isActive
                              ? now - Date.parse(session.startTime)
                              : computeSessionDurationMs(session);
                            const rate = computeDeliveryRate(tons, ms);
                            const isEditingNotes = editingNotes === session.id;

                            return (
                              <tr
                                key={session.id}
                                className={`border-b border-border/50 last:border-0 ${isActive ? 'bg-primary/5' : 'hover:bg-muted/20'}`}
                              >
                                <td className="px-4 py-2">
                                  <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1">
                                      {isActive && <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />}
                                      {editingTime?.sessionId === session.id && editingTime.field === 'start' ? (
                                        <input
                                          type="datetime-local"
                                          autoFocus
                                          defaultValue={toLocalInput(session.startTime)}
                                          onBlur={(e) => handleSaveTime(session.id, 'start', e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSaveTime(session.id, 'start', (e.target as HTMLInputElement).value);
                                            if (e.key === 'Escape') setEditingTime(null);
                                          }}
                                          className="bg-transparent border border-primary/30 rounded px-1 text-xs outline-none"
                                        />
                                      ) : (
                                        <button
                                          onClick={() => !isActive && setEditingTime({ sessionId: session.id, field: 'start' })}
                                          className={`text-xs ${isActive ? '' : 'hover:text-primary cursor-pointer'}`}
                                          title={isActive ? 'Stop session to edit' : 'Click to edit start time'}
                                        >
                                          {new Date(session.startTime).toLocaleDateString(undefined, {
                                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                          })}
                                        </button>
                                      )}
                                    </div>
                                    {session.endTime && (
                                      <div className="flex items-center gap-1 text-muted-foreground">
                                        <span className="text-[10px]">{'\u2192'}</span>
                                        {editingTime?.sessionId === session.id && editingTime.field === 'end' ? (
                                          <input
                                            type="datetime-local"
                                            autoFocus
                                            defaultValue={toLocalInput(session.endTime)}
                                            onBlur={(e) => handleSaveTime(session.id, 'end', e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') handleSaveTime(session.id, 'end', (e.target as HTMLInputElement).value);
                                              if (e.key === 'Escape') setEditingTime(null);
                                            }}
                                            className="bg-transparent border border-primary/30 rounded px-1 text-xs outline-none"
                                          />
                                        ) : (
                                          <button
                                            onClick={() => setEditingTime({ sessionId: session.id, field: 'end' })}
                                            className="text-[11px] hover:text-primary cursor-pointer"
                                            title="Click to edit end time"
                                          >
                                            {new Date(session.endTime).toLocaleTimeString(undefined, {
                                              hour: '2-digit', minute: '2-digit',
                                            })}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-right font-mono">{formatDuration(ms)}</td>
                                <td className="px-4 py-2 text-right">{formatNumber(tons)}t</td>
                                <td className="px-4 py-2 text-right">{rate > 0 ? `${Math.round(rate)} t/hr` : '--'}</td>
                                <td className="px-4 py-2">
                                  {isEditingNotes ? (
                                    <input
                                      autoFocus
                                      value={notesValue}
                                      onChange={(e) => setNotesValue(e.target.value)}
                                      onBlur={() => handleSaveNotes(session.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveNotes(session.id);
                                        if (e.key === 'Escape') setEditingNotes(null);
                                      }}
                                      className="w-full bg-transparent border-b border-primary/30 text-sm outline-none px-1"
                                      placeholder="Add a note..."
                                    />
                                  ) : (
                                    <button
                                      onClick={() => { setEditingNotes(session.id); setNotesValue(session.notes || ''); }}
                                      className="text-xs text-muted-foreground hover:text-foreground truncate max-w-[200px] block"
                                      title={session.notes || 'Click to add notes'}
                                    >
                                      {session.notes || 'Add notes...'}
                                    </button>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right">
                                  {isActive ? (
                                    <button
                                      onClick={stopSession}
                                      className="text-xs text-destructive hover:text-destructive/80"
                                    >
                                      Stop
                                    </button>
                                  ) : confirmDelete === session.id ? (
                                    <div className="flex gap-1 justify-end">
                                      <button
                                        onClick={() => handleDelete(session.id)}
                                        className="text-xs text-destructive hover:text-destructive/80"
                                      >
                                        Confirm
                                      </button>
                                      <button
                                        onClick={() => setConfirmDelete(null)}
                                        className="text-xs text-muted-foreground hover:text-foreground"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setConfirmDelete(session.id)}
                                      className="text-xs text-muted-foreground hover:text-destructive"
                                      title="Delete session"
                                    >
                                      {'\u2715'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
