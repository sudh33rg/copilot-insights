import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RpcClient } from './rpcClient';
import { RpcProvider } from './rpcContext';
import { createVsCodeTransport } from './vscodeTransport';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');

const client = new RpcClient(createVsCodeTransport());
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });
// dataChanged is the only host event today: refetch whatever is on screen.
client.onEvent(() => {
  void queryClient.invalidateQueries();
});

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={client}>
        <App view={container.dataset.view === 'sidebar' ? 'sidebar' : 'dashboard'} />
      </RpcProvider>
    </QueryClientProvider>
  </StrictMode>,
);
