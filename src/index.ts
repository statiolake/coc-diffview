import path from "node:path";
import { promises as fs } from "node:fs";
import {
  commands,
  Event,
  Emitter,
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

type DiffFile = {
  root: string;
  path: string;
  status: string;
  base: string;
  target: string;
};

type DiffSession = {
  leftWindow: number;
  rightWindow: number;
};

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

class Diffview {
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
      commands.registerCommand("coc-diffview.close", () => this.close()),
    );
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
    const parent = `${hash}^`;
    await this.showFiles(root, parent, hash);
  }

  private async showFiles(
    root: string,
    base: string,
    target: string,
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
    await this.close();
    const relative = file.path;
    const left = await this.fileContents(file.root, file.base, relative);
    const right = await this.fileContents(file.root, file.target, relative);
    const editor = await this.editorWindow();
    if (!editor) return;

    await workspace.nvim.call("win_gotoid", [editor]);
    await this.ui.openLocation(
      Uri.file(path.join(file.root, relative)).toString(),
      0,
      0,
    );
    const rightWindow = (await workspace.nvim.call("win_getid")) as number;
    await workspace.nvim.command("leftabove vsplit");
    const leftWindow = (await workspace.nvim.call("win_getid")) as number;
    const leftBuffer = (await workspace.nvim.call("nvim_create_buf", [
      false,
      true,
    ])) as number;
    await workspace.nvim.call("nvim_buf_set_name", [
      leftBuffer,
      `coc-diffview://${file.base}/${relative}`,
    ]);
    await workspace.nvim.call("nvim_buf_set_lines", [
      leftBuffer,
      0,
      -1,
      false,
      left.split("\n"),
    ]);
    await workspace.nvim.call("nvim_win_set_buf", [leftWindow, leftBuffer]);
    await workspace.nvim.command(
      "setlocal buftype=nofile bufhidden=wipe noswapfile nomodifiable diff",
    );

    if (file.target !== "WORKTREE") {
      const rightBuffer = (await workspace.nvim.call("nvim_create_buf", [
        false,
        true,
      ])) as number;
      await workspace.nvim.call("nvim_buf_set_name", [
        rightBuffer,
        `coc-diffview://${file.target}/${relative}`,
      ]);
      await workspace.nvim.call("nvim_buf_set_lines", [
        rightBuffer,
        0,
        -1,
        false,
        right.split("\n"),
      ]);
      await workspace.nvim.call("nvim_win_set_buf", [rightWindow, rightBuffer]);
      await workspace.nvim.call("win_gotoid", [rightWindow]);
      await workspace.nvim.command(
        "setlocal buftype=nofile bufhidden=wipe noswapfile nomodifiable",
      );
    }
    await workspace.nvim.command("setlocal diff");

    this.session = { leftWindow, rightWindow };
  }

  private async close(): Promise<void> {
    if (!this.session) return;
    const { leftWindow, rightWindow } = this.session;
    this.session = undefined;
    const rightValid = (await workspace.nvim.call("nvim_win_is_valid", [
      rightWindow,
    ])) as boolean;
    if (rightValid) {
      await workspace.nvim.call("win_gotoid", [rightWindow]);
      await workspace.nvim.command("diffoff");
    }
    const leftValid = (await workspace.nvim.call("nvim_win_is_valid", [
      leftWindow,
    ])) as boolean;
    if (leftValid)
      await workspace.nvim.call("nvim_win_close", [leftWindow, true]);
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
    ref: string,
    relative: string,
  ): Promise<string> {
    if (ref === "WORKTREE") {
      try {
        return await fs.readFile(path.join(root, relative), "utf8");
      } catch {
        return await this.git.diff(root, ["show", `HEAD:${relative}`]);
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

function parseFiles(
  output: string,
  root: string,
  base: string,
  target: string,
): DiffFile[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...parts] = line.split("\t");
      return { root, status, path: parts.at(-1) as string, base, target };
    });
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
