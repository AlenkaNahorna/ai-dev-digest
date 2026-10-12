import simpleGit from 'simple-git';

const git = simpleGit();

export function isValidNoteTitle(title: string): boolean {
  return title.trim().length > 0 && title.trim().length <= 120;
}

export async function lastEditorEmail(filePath: string): Promise<string | undefined> {
  const log = await git.log({ file: filePath, maxCount: 1 });
  return log.latest?.author_email;
}
