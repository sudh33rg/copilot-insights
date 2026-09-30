import { useState } from 'react';
import { Button } from './ui/Button';
import { DiagnosticsView } from './views/DiagnosticsView';
import { IndexStatus } from './views/IndexStatus';
import { OverviewView } from './views/OverviewView';
import { SessionDetailView } from './views/SessionDetailView';
import { SessionsView } from './views/SessionsView';
import { SidebarView } from './views/SidebarView';

export function App({ view }: { view: 'dashboard' | 'sidebar' }) {
  return (
    <main className={`app app--${view}`}>{view === 'sidebar' ? <SidebarView /> : <DashboardView />}</main>
  );
}

const TAB_LABEL = { overview: 'Overview', sessions: 'Sessions', diagnostics: 'Diagnostics' } as const;

function DashboardView() {
  const [tab, setTab] = useState<'overview' | 'sessions' | 'diagnostics'>('overview');
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <h1>Copilot Insights</h1>
      <IndexStatus />
      <nav className="tabs" aria-label="Dashboard sections">
        {(['overview', 'sessions', 'diagnostics'] as const).map((name) => (
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
