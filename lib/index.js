"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  activate: () => activate
});
module.exports = __toCommonJS(index_exports);
var import_node_path = __toESM(require("node:path"));
var import_node_fs = require("node:fs");
var import_coc = require("coc.nvim");
var DiffFilesProvider = class {
  changeEmitter = new import_coc.Emitter();
  onDidChangeTreeData = this.changeEmitter.event;
  files = [];
  set(files) {
    this.files = files;
    this.changeEmitter.fire();
  }
  getChildren() {
    return this.files;
  }
  getTreeItem(file) {
    const item = new import_coc.TreeItem(file.path, import_coc.TreeItemCollapsibleState.None);
    item.description = file.status;
    item.tooltip = `${file.status} ${file.path}`;
    item.command = {
      command: "coc-diffview.openFile",
      title: "Open Diff",
      arguments: [file]
    };
    return item;
  }
};
var FileHistoryProvider = class {
  changeEmitter = new import_coc.Emitter();
  onDidChangeTreeData = this.changeEmitter.event;
  commits = [];
  set(commits) {
    this.commits = commits;
    this.changeEmitter.fire();
  }
  getChildren() {
    return this.commits;
  }
  getTreeItem(commit) {
    const item = new import_coc.TreeItem(`${commit.hash.slice(0, 10)} ${commit.subject}`);
    item.description = commit.decoration;
    item.tooltip = `${commit.hash}
${commit.subject}`;
    item.command = {
      command: "coc-diffview.showCommit",
      title: "Show Commit Diff",
      arguments: [commit.root, commit.hash]
    };
    return item;
  }
};
var Diffview = class {
  constructor(ui, git, context) {
    this.ui = ui;
    this.git = git;
    const container = ui.registerViewContainer({
      id: "diff",
      title: "Diff",
      icon: "\uEAE1",
      location: "panel",
      order: 1
    });
    const filesView = ui.registerView({
      id: "diff.files",
      containerId: "diff",
      name: "Files",
      order: 1
    });
    const filesTree = ui.createTreeView("diff.files", {
      treeDataProvider: this.files
    });
    const historyView = ui.registerView({
      id: "diff.fileHistory",
      containerId: "diff",
      name: "File History",
      order: 2,
      visibility: "collapsed"
    });
    const historyTree = ui.createTreeView("diff.fileHistory", {
      treeDataProvider: this.history
    });
    context.subscriptions.push(
      container,
      filesView,
      filesTree,
      historyView,
      historyTree,
      import_coc.commands.registerCommand(
        "coc-diffview.open",
        () => this.openWorkingTree()
      ),
      import_coc.commands.registerCommand("coc-diffview.branch", () => this.openBranch()),
      import_coc.commands.registerCommand(
        "coc-diffview.fileHistory",
        () => this.openFileHistory()
      ),
      import_coc.commands.registerCommand(
        "coc-diffview.showCommit",
        (root, hash) => this.openCommit(root, hash)
      ),
      import_coc.commands.registerCommand(
        "coc-diffview.openFile",
        (file) => this.openFile(file)
      ),
      import_coc.commands.registerCommand("coc-diffview.close", () => this.close())
    );
  }
  files = new DiffFilesProvider();
  history = new FileHistoryProvider();
  session;
  async openWorkingTree() {
    const root = await this.currentRepository();
    if (!root) return;
    await this.showFiles(root, "HEAD", "WORKTREE");
  }
  async openBranch() {
    const root = await this.currentRepository();
    if (!root) return;
    const base = await this.mergeBase(root);
    if (!base) {
      await import_coc.window.showErrorMessage("Could not determine a branch merge base.");
      return;
    }
    await this.showFiles(root, base, "HEAD");
  }
  async openFileHistory() {
    const document = await import_coc.workspace.document;
    const resource = import_coc.Uri.parse(document.textDocument.uri);
    if (resource.scheme !== "file") return;
    const filename = resource.fsPath;
    const root = await this.git.repositoryRoot(filename);
    if (!root) return;
    this.history.set(await this.git.history(root, filename));
    await this.ui.showView("diff.fileHistory");
  }
  async openCommit(root, hash) {
    const parent = `${hash}^`;
    await this.showFiles(root, parent, hash);
  }
  async showFiles(root, base, target) {
    const args = target === "WORKTREE" ? ["diff", "--name-status", base] : ["diff", "--name-status", base, target];
    const output = await this.git.diff(root, args);
    this.files.set(parseFiles(output, root, base, target));
    await this.ui.showView("diff.files");
  }
  async openFile(file) {
    await this.close();
    const relative = file.path;
    const left = await this.fileContents(file.root, file.base, relative);
    const right = await this.fileContents(file.root, file.target, relative);
    const editor = await this.editorWindow();
    if (!editor) return;
    await import_coc.workspace.nvim.call("win_gotoid", [editor]);
    await this.ui.openLocation(
      import_coc.Uri.file(import_node_path.default.join(file.root, relative)).toString(),
      0,
      0
    );
    const rightWindow = await import_coc.workspace.nvim.call("win_getid");
    await import_coc.workspace.nvim.command("leftabove vsplit");
    const leftWindow = await import_coc.workspace.nvim.call("win_getid");
    const leftBuffer = await import_coc.workspace.nvim.call("nvim_create_buf", [
      false,
      true
    ]);
    await import_coc.workspace.nvim.call("nvim_buf_set_name", [
      leftBuffer,
      `coc-diffview://${file.base}/${relative}`
    ]);
    await import_coc.workspace.nvim.call("nvim_buf_set_lines", [
      leftBuffer,
      0,
      -1,
      false,
      left.split("\n")
    ]);
    await import_coc.workspace.nvim.call("nvim_win_set_buf", [leftWindow, leftBuffer]);
    await import_coc.workspace.nvim.command(
      "setlocal buftype=nofile bufhidden=wipe noswapfile nomodifiable diff"
    );
    if (file.target !== "WORKTREE") {
      const rightBuffer = await import_coc.workspace.nvim.call("nvim_create_buf", [
        false,
        true
      ]);
      await import_coc.workspace.nvim.call("nvim_buf_set_name", [
        rightBuffer,
        `coc-diffview://${file.target}/${relative}`
      ]);
      await import_coc.workspace.nvim.call("nvim_buf_set_lines", [
        rightBuffer,
        0,
        -1,
        false,
        right.split("\n")
      ]);
      await import_coc.workspace.nvim.call("nvim_win_set_buf", [rightWindow, rightBuffer]);
      await import_coc.workspace.nvim.call("win_gotoid", [rightWindow]);
      await import_coc.workspace.nvim.command(
        "setlocal buftype=nofile bufhidden=wipe noswapfile nomodifiable"
      );
    }
    await import_coc.workspace.nvim.command("setlocal diff");
    this.session = { leftWindow, rightWindow };
  }
  async close() {
    if (!this.session) return;
    const { leftWindow, rightWindow } = this.session;
    this.session = void 0;
    const rightValid = await import_coc.workspace.nvim.call("nvim_win_is_valid", [
      rightWindow
    ]);
    if (rightValid) {
      await import_coc.workspace.nvim.call("win_gotoid", [rightWindow]);
      await import_coc.workspace.nvim.command("diffoff");
    }
    const leftValid = await import_coc.workspace.nvim.call("nvim_win_is_valid", [
      leftWindow
    ]);
    if (leftValid)
      await import_coc.workspace.nvim.call("nvim_win_close", [leftWindow, true]);
  }
  async currentRepository() {
    const document = await import_coc.workspace.document;
    const resource = import_coc.Uri.parse(document.textDocument.uri);
    return resource.scheme === "file" ? this.git.repositoryRoot(resource.fsPath) : this.git.repositoryRoot();
  }
  async mergeBase(root) {
    for (const branch of ["origin/develop", "origin/master", "origin/main"]) {
      try {
        return (await this.git.diff(root, ["merge-base", "HEAD", branch])).trim();
      } catch {
      }
    }
    return void 0;
  }
  async fileContents(root, ref, relative) {
    if (ref === "WORKTREE") {
      try {
        return await import_node_fs.promises.readFile(import_node_path.default.join(root, relative), "utf8");
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
  async editorWindow() {
    const windows = await import_coc.workspace.nvim.call("nvim_list_wins");
    for (const windowId of windows) {
      const buffer = await import_coc.workspace.nvim.call("nvim_win_get_buf", [
        windowId
      ]);
      const type = await import_coc.workspace.nvim.call("getbufvar", [
        buffer,
        "&buftype"
      ]);
      if (!type) return windowId;
    }
    return void 0;
  }
};
function parseFiles(output, root, base, target) {
  return output.split("\n").filter(Boolean).map((line) => {
    const [status, ...parts] = line.split("	");
    return { root, status, path: parts.at(-1), base, target };
  });
}
async function activate(context) {
  const uiExtension = import_coc.extensions.getExtensionById("@statiolake/coc-ui");
  const gitExtension = import_coc.extensions.getExtensionById(
    "@statiolake/coc-git"
  );
  if (!uiExtension?.exports || !gitExtension?.exports) {
    throw new Error(
      "coc-diffview requires active coc-ui and coc-git extensions"
    );
  }
  new Diffview(uiExtension.exports, gitExtension.exports, context);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate
});
//# sourceMappingURL=index.js.map
