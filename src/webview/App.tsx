import { useState } from 'react';
import { Button } from './ui/Button';
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

function DashboardView() {
  const [tab, setTab] = useState<'overview' | 'sessions'>('overview');
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <h1>Copilot Insights</h1>
      <IndexStatus />
      <nav className="tabs" aria-label="Dashboard sections">
        {(['overview', 'sessions'] as const).map((name) => (
          <Button
            key={name}
            variant={tab === name ? 'primary' : 'secondary'}
            aria-current={tab === name ? 'page' : undefined}
            onClick={() => {
              setTab(name);
              setSelected(null);
            }}
          >
            {name === 'overview' ? 'Overview' : 'Sessions'}
          </Button>
        ))}
      </nav>
      {tab === 'overview' && <OverviewView />}
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
