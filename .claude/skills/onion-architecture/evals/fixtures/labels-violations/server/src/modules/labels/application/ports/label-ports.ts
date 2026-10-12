export interface LabelRow {
  id: string;
  repoId: string;
  name: string;
  color: string;
}

export interface LabelRepositoryPort {
  listForRepo(repoId: string): Promise<LabelRow[]>;
  create(repoId: string, name: string, color: string): Promise<LabelRow>;
}
