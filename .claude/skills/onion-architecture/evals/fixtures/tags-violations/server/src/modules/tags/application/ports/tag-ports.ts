export interface TagRow {
  id: string;
  pullId: string;
  name: string;
}

export interface TagRepositoryPort {
  listForPull(pullId: string): Promise<TagRow[]>;
  assign(pullId: string, name: string): Promise<TagRow>;
}
