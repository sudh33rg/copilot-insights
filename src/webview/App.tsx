import { useState } from 'react';
import { IndexStatus } from './views/IndexStatus';
import { SessionDetailView } from './views/SessionDetailView';
import { SessionsView } from './views/SessionsView';

export function App({ view }: { view: 'dashboard' | 'sidebar' }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <main className={`app app--${view}`}>
      <h1>Copilot Insights</h1>
      <IndexStatus />
      {view === 'dashboard' &&
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
    </main>
  );
}
