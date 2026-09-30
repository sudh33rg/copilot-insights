import * as vscode from 'vscode';

/** `read:user` is enough for the user's own billing endpoint. Interactive only when the user asked to sync. */
export async function githubSession(interactive: boolean): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession(
    'github',
    ['read:user'],
    interactive ? { createIfNone: true } : { silent: true },
  );
}
