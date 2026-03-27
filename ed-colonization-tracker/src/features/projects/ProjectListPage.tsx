import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import { cleanProjectName } from '@/lib/utils';

type Filter = 'active' | 'completed' | 'all';

export function ProjectListPage() {
  const projects = useAppStore((s) => s.projects);
  const [filter, setFilter] = useState<Filter>('active');

  const filtered = useMemo(() => {
    if (filter === 'all') return projects;
    return projects.filter((p) => p.status === filter);
  }, [projects, filter]);

  const counts = useMemo(() => ({
    active: projects.filter((p) => p.status === 'active').length,
    completed: projects.filter((p) => p.status === 'completed').length,
    all: projects.length,
  }), [projects]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Projects</h2>
        <Link
          to="/projects/new"
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          + New Project
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-muted/30 rounded-lg p-1 w-fit">
        {([['active', 'Active'], ['completed', 'Completed'], ['all', 'All']] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label} <span className="text-xs opacity-70">{counts[key]}</span>
          </button>
        ))}
      </div>

      {projects.length === 0 ? (
        <p className="text-muted-foreground">No projects yet. Create one to get started.</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground">No {filter} projects.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="flex items-center justify-between bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors"
            >
              <div>
                <span className="font-medium">{cleanProjectName(p.name)}</span>
                <span className="text-muted-foreground ml-2 text-sm">({p.systemName})</span>
              </div>
              <span className={`text-xs px-2 py-1 rounded ${
                p.status === 'active' ? 'bg-progress-high/20 text-progress-high' :
                p.status === 'completed' ? 'bg-progress-complete/20 text-progress-complete' :
                'bg-muted text-muted-foreground'
              }`}>
                {p.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
