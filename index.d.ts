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
  closeDiffAndOpenFile(): Promise<void>;
  /** @deprecated Providers should expose an explicit open/close workflow. */
  toggle(options?: OpenDiffOptions): Promise<void>;
  toggleLayout(): Promise<void>;
}
