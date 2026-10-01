import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SavedSessionView } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';

export function SavedViews({
  filters,
  onApply,
}: {
  filters: SavedSessionView['filters'];
  onApply: (filters: SavedSessionView['filters']) => void;
}) {
  const rpc = useRpc();
  const client = useQueryClient();
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState('');
  const views = useQuery({ queryKey: ['savedViews'], queryFn: () => rpc.call('getSavedViews', {}) });
  const save = useMutation({
    mutationFn: () => rpc.call('saveView', { id: crypto.randomUUID(), label: label.trim(), filters }),
    onSuccess: async () => {
      setLabel('');
      await client.invalidateQueries({ queryKey: ['savedViews'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => rpc.call('deleteView', { id: selected }),
    onSuccess: async () => {
      setSelected('');
      await client.invalidateQueries({ queryKey: ['savedViews'] });
    },
  });
  return (
    <details className="filter-panel">
      <summary>Saved views</summary>
      <div className="toolbar">
        <label>
          Load view{' '}
          <select
            value={selected}
            onChange={(e) => {
              const id = e.target.value;
              setSelected(id);
              const view = views.data?.find((v) => v.id === id);
              if (view) onApply(view.filters);
            }}
          >
            <option value="">Choose a saved view…</option>
            {views.data?.map((view) => (
              <option key={view.id} value={view.id}>
                {view.label}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <Button
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate();
            }}
          >
            Delete saved view
          </Button>
        )}
        <label>
          View name{' '}
          <input
            value={label}
            maxLength={80}
            onChange={(e) => {
              setLabel(e.target.value);
            }}
          />
        </label>
        <Button
          disabled={!label.trim() || save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          Save current filters
        </Button>
      </div>
      {views.isError && <p className="muted">Could not load saved views: {views.error.message}</p>}
      {save.isError && <p role="alert">Could not save view: {save.error.message}</p>}
      {remove.isError && <p role="alert">Could not delete view: {remove.error.message}</p>}
    </details>
  );
}
