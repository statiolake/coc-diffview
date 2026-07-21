import {
  commands,
  Disposable,
  events,
  ExtensionContext,
  workspace,
} from "coc.nvim";
import { lineChanges } from "./lineDiff";

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
  toggle(options?: OpenDiffOptions): Promise<void>;
  toggleLayout(): Promise<void>;
}

type SessionBase = {
  createdBuffers: number[];
  mappedBuffers: number[];
  options: OpenDiffOptions;
};

type SplitSession = SessionBase & {
  kind: "split";
  leftWindow: number;
  rightWindow: number;
};

type UnifiedSession = SessionBase & {
  kind: "unified";
  window: number;
  buffer: number;
  namespace: number;
  originalLines: string[];
  hunkRows: number[];
  signColumn: string;
  refreshTimer?: NodeJS.Timeout;
};

type DiffSession = SplitSession | UnifiedSession;

class Diffview implements CocDiffviewApi, Disposable {
  private session: DiffSession | undefined;
  private lastOptions: OpenDiffOptions | undefined;
  private nextBufferId = 1;

  constructor(context: ExtensionContext) {
    context.subscriptions.push(
      this,
      commands.registerCommand(
        "diffview.open",
        (options: OpenDiffOptions) => this.open(options),
      ),
      commands.registerCommand("diffview.close", () => this.close()),
      commands.registerCommand("diffview.toggle", (options?: OpenDiffOptions) =>
        this.toggle(options),
      ),
      commands.registerCommand("diffview.toggleLayout", () =>
        this.toggleLayout(),
      ),
      commands.registerCommand("diffview.nextChange", () =>
        this.navigateChange(1),
      ),
      commands.registerCommand("diffview.previousChange", () =>
        this.navigateChange(-1),
      ),
      events.on("TextChanged", (bufnr) => this.scheduleRender(bufnr)),
      events.on("TextChangedI", (bufnr) => this.scheduleRender(bufnr)),
      events.on("TextChangedP", (bufnr) => this.scheduleRender(bufnr)),
    );
    void this.defineHighlights();
  }

  dispose(): void {
    const session = this.session;
    this.session = undefined;
    if (session) void this.removeNavigationMappings(session);
    if (session?.kind === "unified" && session.refreshTimer)
      clearTimeout(session.refreshTimer);
  }

  async open(options: OpenDiffOptions): Promise<void> {
    validateOptions(options);
    this.lastOptions = options;
    const layout =
      options.layout ??
      workspace
        .getConfiguration("diffview")
        .get<DiffLayout>("layout", "unified");
    if (layout === "split") await this.openSplit(options);
    else await this.openUnified(options);
  }

  async close(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    await this.removeNavigationMappings(session);
    if (session.kind === "unified") {
      if (session.refreshTimer) clearTimeout(session.refreshTimer);
      if (await bufferIsValid(session.buffer)) {
        await workspace.nvim.call("nvim_buf_clear_namespace", [
          session.buffer,
          session.namespace,
          0,
          -1,
        ]);
      }
      if (await windowIsValid(session.window)) {
        await workspace.nvim.call("nvim_set_option_value", [
          "signcolumn",
          session.signColumn,
          { win: session.window },
        ]);
      }
    } else {
      for (const windowId of [session.leftWindow, session.rightWindow]) {
        if (!(await windowIsValid(windowId))) continue;
        await workspace.nvim.call("win_gotoid", [windowId]);
        await workspace.nvim.command("diffoff");
        await workspace.nvim.command("setlocal noscrollbind nocursorbind");
      }
      if (await windowIsValid(session.leftWindow))
        await workspace.nvim.call("nvim_win_close", [session.leftWindow, true]);
    }
    for (const buffer of session.createdBuffers) {
      if (await bufferIsValid(buffer))
        await workspace.nvim.call("nvim_buf_delete", [buffer, { force: true }]);
    }
  }

  async toggle(options?: OpenDiffOptions): Promise<void> {
    if (
      this.session &&
      (!options || sameSource(this.session.options.modified, options.modified))
    ) {
      await this.close();
      return;
    }
    const target = options ?? this.lastOptions;
    if (!target) return;
    await this.open(target);
  }

  async toggleLayout(): Promise<void> {
    const options = this.lastOptions;
    if (!options) return;
    const current = this.session?.kind ?? options.layout ?? "unified";
    await this.open({
      ...options,
      layout: current === "unified" ? "split" : "unified",
    });
  }

  private async openUnified(options: OpenDiffOptions): Promise<void> {
    await this.close();
    const originalLines = await this.readSource(options.original);
    const editor = await this.editorWindow();
    if (!editor) return;
    const createdBuffers: number[] = [];
    await workspace.nvim.call("win_gotoid", [editor]);
    const buffer = await this.openModified(options.modified, createdBuffers);
    const windowId = (await workspace.nvim.call("win_getid")) as number;
    const signColumn = (await workspace.nvim.call("nvim_get_option_value", [
      "signcolumn",
      { win: windowId },
    ])) as string;
    await workspace.nvim.call("nvim_set_option_value", [
      "signcolumn",
      "yes",
      { win: windowId },
    ]);
    const namespace = (await workspace.nvim.call("nvim_create_namespace", [
      "coc-diffview-unified",
    ])) as number;
    this.session = {
      kind: "unified",
      window: windowId,
      buffer,
      namespace,
      originalLines,
      hunkRows: [],
      signColumn,
      createdBuffers,
      mappedBuffers: [],
      options,
    };
    await this.installNavigationMappings(this.session, [buffer]);
    await this.renderUnified(this.session);
  }

  private async openSplit(options: OpenDiffOptions): Promise<void> {
    await this.close();
    const editor = await this.editorWindow();
    if (!editor) return;
    const createdBuffers: number[] = [];
    await workspace.nvim.call("win_gotoid", [editor]);
    const modified = await this.openModified(options.modified, createdBuffers);
    const rightWindow = (await workspace.nvim.call("win_getid")) as number;
    await workspace.nvim.command("leftabove vsplit");
    const leftWindow = (await workspace.nvim.call("win_getid")) as number;
    const original = await this.snapshotBuffer(options.original);
    createdBuffers.push(original);
    await workspace.nvim.call("nvim_win_set_buf", [leftWindow, original]);
    await workspace.nvim.command(
      "setlocal buftype=nofile bufhidden=wipe noswapfile nomodifiable",
    );
    await workspace.nvim.command("diffthis");
    await workspace.nvim.command("setlocal scrollbind cursorbind");

    await workspace.nvim.call("win_gotoid", [rightWindow]);
    await workspace.nvim.command("diffthis");
    await workspace.nvim.command("setlocal scrollbind cursorbind");
    this.session = {
      kind: "split",
      leftWindow,
      rightWindow,
      createdBuffers,
      mappedBuffers: [],
      options,
    };
    await this.installNavigationMappings(this.session, [original, modified]);
  }

  private async openModified(
    source: DiffSource,
    createdBuffers: number[],
  ): Promise<number> {
    if (source.kind === "buffer") {
      if (!(await bufferIsValid(source.buffer)))
        throw new Error(`Invalid modified buffer: ${source.buffer}`);
      await workspace.nvim.call("nvim_win_set_buf", [0, source.buffer]);
      return source.buffer;
    }
    const buffer = await this.textBuffer(source, true);
    createdBuffers.push(buffer);
    await workspace.nvim.call("nvim_win_set_buf", [0, buffer]);
    return buffer;
  }

  private async snapshotBuffer(source: DiffSource): Promise<number> {
    const lines = await this.readSource(source);
    return this.textBuffer(
      {
        kind: "text",
        text: lines.join("\n"),
        label: source.label ?? "original",
        filetype: await this.sourceFiletype(source),
      },
      false,
    );
  }

  private async textBuffer(
    source: Extract<DiffSource, { kind: "text" }>,
    modifiable: boolean,
  ): Promise<number> {
    const buffer = (await workspace.nvim.call("nvim_create_buf", [
      false,
      true,
    ])) as number;
    const label = source.label.replaceAll("/", "_");
    await workspace.nvim.call("nvim_buf_set_name", [
      buffer,
      `coc-diffview://${this.nextBufferId++}/${label}`,
    ]);
    await workspace.nvim.call("nvim_buf_set_lines", [
      buffer,
      0,
      -1,
      false,
      splitLines(source.text),
    ]);
    if (source.filetype)
      await workspace.nvim.call("nvim_set_option_value", [
        "filetype",
        source.filetype,
        { buf: buffer },
      ]);
    await workspace.nvim.call("nvim_set_option_value", [
      "buftype",
      "nofile",
      { buf: buffer },
    ]);
    await workspace.nvim.call("nvim_set_option_value", [
      "bufhidden",
      "wipe",
      { buf: buffer },
    ]);
    await workspace.nvim.call("nvim_set_option_value", [
      "swapfile",
      false,
      { buf: buffer },
    ]);
    await workspace.nvim.call("nvim_set_option_value", [
      "modified",
      false,
      { buf: buffer },
    ]);
    await workspace.nvim.call("nvim_set_option_value", [
      "modifiable",
      modifiable,
      { buf: buffer },
    ]);
    return buffer;
  }

  private async readSource(source: DiffSource): Promise<string[]> {
    if (source.kind === "text") return splitLines(source.text);
    if (!(await bufferIsValid(source.buffer)))
      throw new Error(`Invalid diff buffer: ${source.buffer}`);
    return (await workspace.nvim.call("nvim_buf_get_lines", [
      source.buffer,
      0,
      -1,
      false,
    ])) as string[];
  }

  private async sourceFiletype(source: DiffSource): Promise<string | undefined> {
    if (source.kind === "text") return source.filetype;
    return (await workspace.nvim.call("nvim_get_option_value", [
      "filetype",
      { buf: source.buffer },
    ])) as string;
  }

  private scheduleRender(bufnr: number): void {
    const session = this.session;
    if (session?.kind !== "unified" || session.buffer !== bufnr) return;
    if (session.refreshTimer) clearTimeout(session.refreshTimer);
    session.refreshTimer = setTimeout(() => {
      session.refreshTimer = undefined;
      if (this.session === session) void this.renderUnified(session);
    }, 80);
  }

  private async renderUnified(session: UnifiedSession): Promise<void> {
    if (!(await bufferIsValid(session.buffer)) || this.session !== session) return;
    const current = (await workspace.nvim.call("nvim_buf_get_lines", [
      session.buffer,
      0,
      -1,
      false,
    ])) as string[];
    await workspace.nvim.call("nvim_buf_clear_namespace", [
      session.buffer,
      session.namespace,
      0,
      -1,
    ]);
    const windowInfo = (await workspace.nvim.call("getwininfo", [
      session.window,
    ])) as Array<{ textoff: number }>;
    const textOffset = windowInfo[0]?.textoff ?? 0;
    const changes = lineChanges(session.originalLines, current);
    session.hunkRows = changes.map((change) =>
      Math.min(change.newStart, Math.max(0, current.length - 1)),
    );
    for (const change of changes) {
      if (change.removed.length) {
        const atEnd = change.newStart >= current.length;
        const row = atEnd ? Math.max(0, current.length - 1) : change.newStart;
        await workspace.nvim.call("nvim_buf_set_extmark", [
          session.buffer,
          session.namespace,
          row,
          0,
          {
            virt_lines: change.removed.map((line) =>
              removedVirtualLine(line, textOffset),
            ),
            virt_lines_above: !atEnd,
            virt_lines_leftcol: true,
          },
        ]);
      }
      if (change.added.length) {
        const highlight = change.removed.length
          ? "CocDiffviewChanged"
          : "CocDiffviewAdded";
        for (
          let row = change.newStart;
          row < change.newStart + change.added.length;
          row++
        ) {
          await workspace.nvim.call("nvim_buf_set_extmark", [
            session.buffer,
            session.namespace,
            row,
            0,
            {
              sign_text: "┃",
              sign_hl_group: `${highlight}Sign`,
              line_hl_group: highlight,
            },
          ]);
        }
      }
    }
  }

  private async navigateChange(direction: -1 | 1): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (session.kind === "split") {
      await workspace.nvim.command(`normal! ${direction > 0 ? "]c" : "[c"}`);
      return;
    }
    const window = (await workspace.nvim.call("win_getid")) as number;
    if (window !== session.window || !session.hunkRows.length) return;
    const cursor = (await workspace.nvim.call("nvim_win_get_cursor", [window])) as [number, number];
    const currentRow = cursor[0] - 1;
    const target = direction > 0
      ? session.hunkRows.find((row) => row > currentRow)
      : [...session.hunkRows].reverse().find((row) => row < currentRow);
    if (target === undefined) return;
    await workspace.nvim.call("nvim_win_set_cursor", [window, [target + 1, 0]]);
  }

  private async installNavigationMappings(
    session: DiffSession,
    buffers: number[],
  ): Promise<void> {
    for (const buffer of new Set(buffers)) {
      const mappings = (await workspace.nvim.call("nvim_buf_get_keymap", [buffer, "n"])) as Array<{ lhs: string }>;
      for (const [key, command] of [["]c", "diffview.nextChange"], ["[c", "diffview.previousChange"]]) {
        if (mappings.some((mapping) => mapping.lhs === key)) continue;
        await workspace.nvim.call("nvim_buf_set_keymap", [buffer, "n", key, `<Cmd>CocCommand ${command}<CR>`, {
          noremap: true,
          silent: true,
          nowait: true,
        }]);
      }
      session.mappedBuffers.push(buffer);
    }
  }

  private async removeNavigationMappings(session: DiffSession): Promise<void> {
    for (const buffer of session.mappedBuffers) {
      if (!(await bufferIsValid(buffer))) continue;
      const mappings = (await workspace.nvim.call("nvim_buf_get_keymap", [buffer, "n"])) as Array<{ lhs: string; rhs?: string }>;
      for (const [key, command] of [["]c", "diffview.nextChange"], ["[c", "diffview.previousChange"]]) {
        const mapping = mappings.find((candidate) => candidate.lhs === key);
        if (mapping?.rhs !== `<Cmd>CocCommand ${command}<CR>`) continue;
        await workspace.nvim.call("nvim_buf_del_keymap", [buffer, "n", key]);
      }
    }
  }

  private async defineHighlights(): Promise<void> {
    for (const [group, target] of [
      ["CocDiffviewAdded", "DiffAdd"],
      ["CocDiffviewRemoved", "DiffDelete"],
      ["CocDiffviewChanged", "DiffChange"],
      ["CocDiffviewAddedSign", "Added"],
      ["CocDiffviewChangedSign", "Changed"],
      ["CocDiffviewRemovedSign", "Removed"],
    ]) {
      await workspace.nvim.command(`highlight default link ${group} ${target}`);
    }
  }

  private async editorWindow(): Promise<number | undefined> {
    const windows = (await workspace.nvim.call("nvim_list_wins")) as number[];
    for (const windowId of windows) {
      const buffer = (await workspace.nvim.call("nvim_win_get_buf", [
        windowId,
      ])) as number;
      const type = (await workspace.nvim.call("getbufvar", [
        buffer,
        "&buftype",
      ])) as string;
      if (!type) return windowId;
    }
    return windows[0];
  }
}

function validateOptions(options: OpenDiffOptions): void {
  if (!options?.original || !options.modified)
    throw new Error("diffview.open requires original and modified sources");
}

function sameSource(left: DiffSource, right: DiffSource): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "buffer" && right.kind === "buffer")
    return left.buffer === right.buffer;
  return left.label === right.label;
}

function removedVirtualLine(
  line: string,
  textOffset: number,
): Array<[string, string]> {
  return [
    [" ".repeat(Math.max(0, textOffset - 1)), "Normal"],
    ["┃", "CocDiffviewRemovedSign"],
    [line, "CocDiffviewRemoved"],
  ];
}

function splitLines(contents: string): string[] {
  const lines = contents.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length ? lines : [""];
}

async function bufferIsValid(buffer: number): Promise<boolean> {
  return (await workspace.nvim.call("nvim_buf_is_valid", [buffer])) as boolean;
}

async function windowIsValid(window: number): Promise<boolean> {
  return (await workspace.nvim.call("nvim_win_is_valid", [window])) as boolean;
}

export async function activate(
  context: ExtensionContext,
): Promise<CocDiffviewApi> {
  return new Diffview(context);
}
