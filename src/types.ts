export type Collection = "keywords" | "pages" | "content" | "results";
export type Row = { id: string; [key: string]: string | number | undefined };
export type Project = {
  id: string;
  name: string;
  domain: string;
  market: string;
  language: string;
  projectType: string;
  goal: string;
  startDate: string;
  lastReview: string;
  keywords: Row[];
  pages: Row[];
  content: Row[];
  results: Row[];
};
export type Settings = {
  titleMin: number;
  titleMax: number;
  metaMin: number;
  metaMax: number;
  customLabels?: Record<string, string>;
};
export type Store = {
  version: 1;
  activeProjectId: string;
  projects: Project[];
  settings: Settings;
};
export type Field = {
  key: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "select" | "url";
  options?: string[];
  hint?: string;
  calculated?: boolean;
};
export type Section = { key: string; label: string; fields: Field[] };
export type WorkspaceProps = {
  project: Project;
  settings: Settings;
  onRowsChange: (collection: Collection, rows: Row[]) => void;
  notify: (message: string) => void;
};
