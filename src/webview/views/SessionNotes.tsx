import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SessionDetail } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';

export function SessionNotes({ session }: { session: SessionDetail }) {
  const rpc = useRpc();
  const client = useQueryClient();
  const [note, setNote] = useState(session.annotation?.note ?? '');
  const [tags, setTags] = useState(session.annotation?.tags.join(', ') ?? '');
  const [bookmarked, setBookmarked] = useState(session.annotation?.bookmarked ?? false);
  const save = useMutation({
    mutationFn: () =>
      rpc.call('saveAnnotation', {
        id: session.id,
        annotation: {
          bookmarked,
          note,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: async (annotation) => {
      setNote(annotation.note);
      setTags(annotation.tags.join(', '));
      await client.invalidateQueries();
    },
  });
  const invalidTags =
    tags.split(',').filter((tag) => tag.trim()).length > 20 ||
    tags.split(',').some((tag) => tag.trim().length > 40);
  return (
    <section className="card" aria-label="Local session notes">
      <h3>Keep what you learned</h3>
      <p className="muted">
        Notes stay in this extension’s local index. Clearing conversation content also clears notes and tags;
        deleting the session removes its bookmark.
      </p>
      <label className="field">
        <input
          type="checkbox"
          checked={bookmarked}
          onChange={(e) => {
            setBookmarked(e.target.checked);
          }}
        />{' '}
        Bookmark session
      </label>
      <label className="field">
        Session note
        <textarea
          rows={8}
          maxLength={8000}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </label>
      <label className="field">
        Tags
        <input
          value={tags}
          onChange={(e) => {
            setTags(e.target.value);
          }}
          placeholder="Comma-separated tags"
        />
      </label>
      {invalidTags && <p role="alert">Use up to 20 tags, each no longer than 40 characters.</p>}
      <Button
        disabled={save.isPending || invalidTags}
        onClick={() => {
          save.mutate();
        }}
      >
        {save.isPending ? 'Saving…' : 'Save notes'}
      </Button>
      {save.isSuccess && <p role="status">Notes saved locally.</p>}
      {save.isError && <p role="alert">Could not save notes: {save.error.message}</p>}
    </section>
  );
}
