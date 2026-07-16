import path from "node:path";
import { promises as fs } from "node:fs";
import {
  commands,
  Disposable,
  Event,
  Emitter,
  events,
  ExtensionContext,
  extensions,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
  workspace,
} from "coc.nvim";
import type { CocGitApi, GitCommit } from "@statiolake/coc-git";
import type { CocUiApi } from "@statiolake/coc-ui";
import { lineChanges } from "./lineDiff";

type DiffRef = "WORKTREE" | string;

type DiffFile = {
  root: string;
  path: string;
  basePath: string;
  status: string;
  base: DiffRef;
  target: DiffRef;
};

type SplitSession = {
  kind: "split";
  leftWindow: number;
  rightWindow: number;
};

type UnifiedSession = {
  kind: "unified";
  window: number;
  buffer: number;
  namespace: number;
  baseLines: string[];
  refreshTimer?: NodeJS.Timeout;
};

type DiffSession = SplitSession | UnifiedSession;

class DiffFilesProvider implements TreeDataProvider<DiffFile> {
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChangeTreeData: Event<void> = this.changeEmitter.event;
  private files: DiffFile[] = [];

  set(files: DiffFile[]): void {
    this.files = files;
    this.changeEmitter.fire();
  }

  getChildren(): DiffFile[] {
    return this.files;
  }

  getTreeItem(file: DiffFile): TreeItem {
    const item = new TreeItem(file.path, TreeItemCollapsibleState.None);
    item.description = file.status;
    item.tooltip = `${file.status} ${file.path}`;
    item.command = {
      command: "coc-diffview.openFile",
      title: "Open Diff",
      arguments: [file],
    };
    return item;
  }
}

class FileHistoryProvider implements TreeDataProvider<GitCommit> {
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChangeTreeData: Event<void> = this.changeEmitter.event;
  private commits: GitCommit[] = [];

  set(commits: GitCommit[]): void {
    this.commits = commits;
    this.changeEmitter.fire();
  }

  getChildren(): GitCommit[] {
    return this.commits;
  }

  getTreeItem(commit: GitCommit): TreeItem {
    const item = new TreeItem(`${commit.hash.slice(0, 10)} ${commit.subject}`);
    item.description = commit.decoration;
    item.tooltip = `${commit.hash}\n${commit.subject}`;
    item.command = {
      command: "coc-diffview.showCommit",
      title: "Show Commit Diff",
      arguments: [commit.root, commit.hash],
    };
    return item;
  }
}

class Diffview implements Disposable {
  private readonly files = new DiffFilesProvider();
  private readonly history = new FileHistoryProvider();
  private session: DiffSession | undefined;

  constructor(
    private readonly ui: CocUiApi,
    private readonly git: CocGitApi,
    context: ExtensionContext,
  ) {
    const container = ui.registerViewContainer({
      id: "diff",
      title: "Diff",
      icon: "",
      location: "panel",
      order: 1,
    });
    const filesView = ui.registerView({
      id: "diff.files",
      containerId: "diff",
      name: "Files",
      order: 1,
    });
    const filesTree = ui.createTreeView("diff.files", {
      treeDataProvider: this.files,
    });
    const historyView = ui.registerView({
      id: "diff.fileHistory",
      containerId: "diff",
      name: "File History",
      order: 2,
      visibility: "collapsed",
    });
    const historyTree = ui.createTreeView("diff.fileHistory", {
      treeDataProvider: this.history,
    });

    context.subscriptions.push(
      this,
      container,
      filesView,
      filesTree,
      historyView,
      historyTree,
      commands.registerCommand("coc-diffview.open", () =>
        this.openWorkingTree(),
      ),
      commands.registerCommand("coc-diffview.branch", () => this.openBranch()),
      commands.registerCommand("coc-diffview.fileHistory", () =>
        this.openFileHistory(),
      ),
      commands.registerCommand(
        "coc-diffview.showCommit",
        (root: string, hash: string) => this.openCommit(root, hash),
      ),
      commands.registerCommand("coc-diffview.openFile", (file: DiffFile) =>
        this.openFile(file),
      ),
      commands.registerCommand(
        "coc-diffview.openFileChange",
        (root: string, relative: string, base = "HEAD", target = "WORKTREE") =>
          this.openFile(createDiffFile(root, relative, base, target)),
      ),
      commands.registerCommand(
        "coc-diffview.openFileUnified",
        (root: string, relative: string, base = "HEAD", target = "WORKTREE") =>
          this.openUnified(createDiffFile(root, relative, base, target)),
      ),
      commands.registerCommand(
        "coc-diffview.openFileSplit",
        (root: string, relative: string, base = "HEAD", target = "WORKTREE") =>
          this.openSplit(createDiffFile(root, relative, base, target)),
      ),
      commands.registerCommand("coc-diffview.close", () => this.close()),
      events.on("TextChanged", (bufnr) => this.scheduleRender(bufnr)),
      events.on("TextChangedI", (bufnr) => this.scheduleRender(bufnr)),
      events.on("TextChangedP", (bufnr) => this.scheduleRender(bufnr)),
    );
  }

  dispose(): void {
    if (this.session?.kind === "unified" && this.session.refreshTimer)
      clearTimeout(this.session.refreshTimer);
  }

  private async openWorkingTree(): Promise<void> {
    const root = await this.currentRepository();
    if (!root) return;
    await this.showFiles(root, "HEAD", "WORKTREE");
  }

  private async openBranch(): Promise<void> {
    const root = await this.currentRepository();
    if (!root) return;
    const base = await this.mergeBase(root);
    if (!base) {
      await window.showErrorMessage("Could not determine a branch merge base.");
      return;
    }
    await this.showFiles(root, base, "HEAD");
  }

  private async openFileHistory(): Promise<void> {
    const document = await workspace.document;
    const resource = Uri.parse(document.textDocument.uri);
    if (resource.scheme !== "file") return;
    const filename = resource.fsPath;
    const root = await this.git.repositoryRoot(filename);
    if (!root) return;
    this.history.set(await this.git.history(root, filename));
    await this.ui.showView("diff.fileHistory");
  }

  private async openCommit(root: string, hash: string): Promise<void> {
    await this.showFiles(root, `${hash}^`, hash);
  }

  private async showFiles(
    root: string,
    base: DiffRef,
    target: DiffRef,
  ): Promise<void> {
    const args =
      target === "WORKTREE"
        ? ["diff", "--name-status", base]
        : ["diff", "--name-status", base, target];
    const output = await this.git.diff(root, args);
    this.files.set(parseFiles(output, root, base, target));
    await this.ui.showView("diff.files");
  }

  private async openFile(file: DiffFile): Promise<void> {
    const layout = workspace
      .getConfiguration("coc-diffview")
      .get<"unified" | "split">("layout", "unified");
    if (layout === "split") await this.openSplit(file);
    else await this.openUnified(file);
  }

  private async openUnified(file: DiffFile): Promise<void> {
    await this.close();
    const base = splitLines(
      await this.fileContents(file.root, file.base, file.basePath),
    );
    const target = await this.fileContents(file.root, file.target, file.path);
    const editor = await this.editorWindow();
    if (!editor) return;
    await workspace.nvim.call("win_gotoid", [editor]);
    const buffer = await this.openTarget(file, target);
    const windowId = (await workspace.nvim.call("win_getid")) as number;
    const namespace = (await workspace.nvim.call("nvim_create_namespace", [
      "coc-diffview-unified",
    ])) as number;
    this.session = {
      kind: "unified",
      window: windowId,
      buffer,
      namespace,
      baseLines: base,
    };
    await this.renderUnified(this.session);
  }

  private async openSplit(file: DiffFile): Promise<void> {
    await this.close();
    const left = await this.fileContents(file.root, file.base, file.basePath);
    const right = await this.fileContents(file.root, file.target, file.path);
    const editor = await this.editorWindow();
    if (!editor) return;

    await workspace.nvim.call("win_gotoid", [editor]);
    await this.openTarget(file, right);
    const rightWindow = (await workspace.nvim.call("win_getid")) as number;
    await workspace.nvim.command("leftabove vsplit");
    const leftWindow = (await workspace.nvim.call("win_getid")) as number;
    const leftBuffer = await this.scratchBuffer(file.base, file.basePath, left);
    await workspace.nvim.call("nvim_win_set_buf", [leftWindow, leftBuffer]);
    await workspace.nvim.command(
      "setlocal buftype=nofile bufhidden=wipe noswapfile nomodifiable",
    );
    await workspace.nvim.command("diffthis");
    await workspace.nvim.command("setlocal scrollbind cursorbind");

    await workspace.nvim.call("win_gotoid", [rightWindow]);
    await workspace.nvim.command("diffthis");
    await workspace.nvim.command("setlocal scrollbind cursorbind");
    this.session = { kind: "split", leftWindow, rightWindow };
  }

  private async openTarget(file: DiffFile, contents: string): Promise<number> {
    if (file.target === "WORKTREE") {
      await this.ui.openLocation(
        Uri.file(path.join(file.root, file.path)).toString(),
        0,
        0,
      );
      return (await workspace.nvim.call("bufnr", ["%"])) as number;
    }
    const buffer = await this.scratchBuffer(file.target, file.path, contents);
    await workspace.nvim.call("nvim_win_set_buf", [0, buffer]);
    await workspace.nvim.command("setlocal buftype=nofile bufhidden=wipe noswapfile");
    return buffer;
  }

  private async scratchBuffer(
    ref: DiffRef,
    relative: string,
    contents: string,
  ): Promise<number> {
    const buffer = (await workspace.nvim.call("nvim_create_buf", [
      false,
      true,
    ])) as number;
    await workspace.nvim.call("nvim_buf_set_name", [
      buffer,
      `coc-diffview://${ref}/${relative}`,
    ]);
    await workspace.nvim.call("nvim_buf_set_lines", [
      buffer,
      0,
      -1,
      false,
      splitLines(contents),
    ]);
    await workspace.nvim.call("nvim_buf_set_option", [buffer, "modified", false]);
    return buffer;
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
    const valid = (await workspace.nvim.call("nvim_buf_is_valid", [
      session.buffer,
    ])) as boolean;
    if (!valid || this.session !== session) return;
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
    for (const change of lineChanges(session.baseLines, current)) {
      if (change.removed.length) {
        const atEnd = change.newStart >= current.length;
        const row = atEnd ? Math.max(0, current.length - 1) : change.newStart;
        await workspace.nvim.call("nvim_buf_set_extmark", [
          session.buffer,
          session.namespace,
          row,
          0,
          {
            virt_lines: change.removed.map((line) => [[line, "DiffDelete"]]),
            virt_lines_above: !atEnd,
            virt_lines_leftcol: true,
          },
        ]);
      }
      if (change.added.length) {
        await workspace.nvim.call("nvim_buf_set_extmark", [
          session.buffer,
          session.namespace,
          change.newStart,
          0,
          {
            end_row: change.newStart + change.added.length,
            hl_group: change.removed.length ? "DiffChange" : "DiffAdd",
            hl_eol: true,
          },
        ]);
      }
    }
  }

  private async close(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    if (session.kind === "unified") {
      if (session.refreshTimer) clearTimeout(session.refreshTimer);
      const valid = (await workspace.nvim.call("nvim_buf_is_valid", [
        session.buffer,
      ])) as boolean;
      if (valid)
        await workspace.nvim.call("nvim_buf_clear_namespace", [
          session.buffer,
          session.namespace,
          0,
          -1,
        ]);
      return;
    }
    for (const windowId of [session.leftWindow, session.rightWindow]) {
      const valid = (await workspace.nvim.call("nvim_win_is_valid", [
        windowId,
      ])) as boolean;
      if (!valid) continue;
      await workspace.nvim.call("win_gotoid", [windowId]);
      await workspace.nvim.command("diffoff");
      await workspace.nvim.command("setlocal noscrollbind nocursorbind");
    }
    const leftValid = (await workspace.nvim.call("nvim_win_is_valid", [
      session.leftWindow,
    ])) as boolean;
    if (leftValid)
      await workspace.nvim.call("nvim_win_close", [session.leftWindow, true]);
  }

  private async currentRepository(): Promise<string | undefined> {
    const document = await workspace.document;
    const resource = Uri.parse(document.textDocument.uri);
    return resource.scheme === "file"
      ? this.git.repositoryRoot(resource.fsPath)
      : this.git.repositoryRoot();
  }

  private async mergeBase(root: string): Promise<string | undefined> {
    for (const branch of ["origin/develop", "origin/master", "origin/main"]) {
      try {
        return (
          await this.git.diff(root, ["merge-base", "HEAD", branch])
        ).trim();
      } catch {
        // Try the next conventional upstream branch.
      }
    }
    return undefined;
  }

  private async fileContents(
    root: string,
    ref: DiffRef,
    relative: string,
  ): Promise<string> {
    if (ref === "WORKTREE") {
      try {
        return await fs.readFile(path.join(root, relative), "utf8");
      } catch {
        return "";
      }
    }
    try {
      return await this.git.diff(root, ["show", `${ref}:${relative}`]);
    } catch {
      return "";
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
    return undefined;
  }
}

function createDiffFile(
  root: string,
  relative: string,
  base: DiffRef,
  target: DiffRef,
): DiffFile {
  return { root, path: relative, basePath: relative, status: "", base, target };
}

function parseFiles(
  output: string,
  root: string,
  base: DiffRef,
  target: DiffRef,
): DiffFile[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...parts] = line.split("\t");
      const renamed = status.startsWith("R") || status.startsWith("C");
      const filePath = parts.at(-1) as string;
      return {
        root,
        status,
        path: filePath,
        basePath: renamed ? parts[0] : filePath,
        base,
        target,
      };
    });
}

function splitLines(contents: string): string[] {
  const lines = contents.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length ? lines : [""];
}

export async function activate(context: ExtensionContext): Promise<void> {
  const uiExtension =
    extensions.getExtensionById<CocUiApi>("@statiolake/coc-ui");
  const gitExtension = extensions.getExtensionById<CocGitApi>(
    "@statiolake/coc-git",
  );
  if (!uiExtension?.exports || !gitExtension?.exports) {
    throw new Error(
      "coc-diffview requires active coc-ui and coc-git extensions",
    );
  }
  new Diffview(uiExtension.exports, gitExtension.exports, context);
}
