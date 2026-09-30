import { useState } from 'react';
import { Button } from './ui/Button';
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

const TABS = ['overview', 'sessions', 'learning', 'diagnostics'] as const;
const TAB_LABEL = {
  overview: 'Overview',
  sessions: 'Sessions',
  learning: 'Learning',
  diagnostics: 'Diagnostics',
} as const;

function DashboardView() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <h1>Copilot Insights</h1>
      <IndexStatus />
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
      {tab === 'overview' && <OverviewView />}
      {tab === 'diagnostics' && <DiagnosticsView />}
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
