import { useState } from 'react';
import { Button } from './ui/Button';
import { AnalyticsView } from './views/AnalyticsView';
import { DiagnosticsView } from './views/DiagnosticsView';
import { IndexStatus } from './views/IndexStatus';
import { LearningView } from './views/LearningView';
import { OverviewView } from './views/OverviewView';
import { SessionDetailView } from './views/SessionDetailView';
import { SessionsView } from './views/SessionsView';
import { SidebarView } from './views/SidebarView';

export function App({ view }: { view: 'dashboard' | 'sidebar' }) {
  return (
    <main className={`app app--${view}`}>{view === 'sidebar' ? <SidebarView /> : <DashboardView />}</main>
  );
}

const TABS = ['overview', 'sessions', 'analytics', 'learning', 'diagnostics'] as const;
const TAB_LABEL = {
  overview: 'Overview',
  sessions: 'Sessions',
  analytics: 'Analytics',
  learning: 'Learning',
  diagnostics: 'Diagnostics',
} as const;

function DashboardView() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◈
          </span>
          <div>
            <p className="eyebrow">Local observability</p>
            <h1>Copilot Insights</h1>
          </div>
        </div>
        <IndexStatus />
      </header>
      <nav className="tabs" aria-label="Dashboard sections">
        {TABS.map((name) => (
          <Button
            key={name}
            variant={tab === name ? 'primary' : 'secondary'}
            aria-current={tab === name ? 'page' : undefined}
            onClick={() => {
              setTab(name);
              setSelected(null);
            }}
          >
            {TAB_LABEL[name]}
          </Button>
        ))}
      </nav>
      {selected === null && (
        <header className="page-heading">
          <p className="eyebrow">
            {tab === 'sessions'
              ? 'Explore your work'
              : tab === 'analytics'
                ? 'Understand your usage'
                : 'Your Copilot workspace'}
          </p>
          <h2>{TAB_LABEL[tab]}</h2>
          <p className="muted">
            {
              {
                overview: 'Activity, usage and outcomes at a glance.',
                sessions: 'Follow every request, tool call and file reference.',
                analytics: 'Explore usage over time, across models and workspaces.',
                learning: 'Find patterns that help you get better results.',
                diagnostics: 'Check capture coverage and the health of your local index.',
              }[tab]
            }
          </p>
        </header>
      )}
      {tab === 'overview' && <OverviewView />}
      {tab === 'diagnostics' && <DiagnosticsView />}
      {tab === 'analytics' && (
        <AnalyticsView
          onOpenSession={(id) => {
            setTab('sessions');
            setSelected(id);
          }}
        />
      )}
      {tab === 'learning' && (
        <LearningView
          onOpenSession={(id) => {
            setTab('sessions');
            setSelected(id);
          }}
        />
      )}
      {tab === 'sessions' &&
        (selected === null ? (
          <SessionsView onOpen={setSelected} />
        ) : (
          <SessionDetailView
            id={selected}
            onBack={() => {
              setSelected(null);
            }}
          />
        ))}
    </>
  );
}
