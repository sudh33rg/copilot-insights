import { IndexStatus } from './views/IndexStatus';
import { SessionsView } from './views/SessionsView';

export function App({ view }: { view: 'dashboard' | 'sidebar' }) {
  return (
    <main className={`app app--${view}`}>
      <h1>Copilot Insights</h1>
      <IndexStatus />
      {view === 'dashboard' && (
        <SessionsView
          onOpen={() => {
            // Wired to the detail view in Task 2.5.
          }}
        />
      )}
    </main>
  );
}
