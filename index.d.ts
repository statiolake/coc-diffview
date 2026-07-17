export type DiffSource =
  | {
      kind: "buffer";
      buffer: number;
      label?: string;
    }
  | {
      kind: "text";
      text: string;
      label: string;
      filetype?: string;
    };

export type DiffLayout = "unified" | "split";

export type OpenDiffOptions = {
  original: DiffSource;
  modified: DiffSource;
  title?: string;
  layout?: DiffLayout;
};

export interface CocDiffviewApi {
  open(options: OpenDiffOptions): Promise<void>;
  close(): Promise<void>;
  toggle(): Promise<void>;
  toggleLayout(): Promise<void>;
}
