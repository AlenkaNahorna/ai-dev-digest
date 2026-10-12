export interface NoteRow {
  id: string;
  repoId: string;
  title: string;
  body: string;
}

export interface NoteRepositoryPort {
  find(id: string): Promise<NoteRow | undefined>;
  save(note: NoteRow): Promise<void>;
}
