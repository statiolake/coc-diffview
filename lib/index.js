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

// src/lineDiff.ts
function lineChanges(before, after) {
  const operations = myersDiff(before, after);
  const changes = [];
  let newLine = 0;
  for (let index = 0; index < operations.length; ) {
    if (operations[index].kind === "equal") {
      newLine++;
      index++;
      continue;
    }
    const change = { removed: [], added: [], newStart: newLine };
    while (index < operations.length && operations[index].kind !== "equal") {
      const operation = operations[index++];
      if (operation.kind === "delete") change.removed.push(operation.line);
      else {
        change.added.push(operation.line);
        newLine++;
      }
    }
    changes.push(change);
  }
  return changes;
}
function myersDiff(before, after) {
  const trace = [];
  let frontier = /* @__PURE__ */ new Map([[1, 0]]);
  const maximum = before.length + after.length;
  for (let distance = 0; distance <= maximum; distance++) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? -1;
      const right = frontier.get(diagonal - 1) ?? -1;
      let x = diagonal === -distance || diagonal !== distance && right < down ? Math.max(0, down) : right + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x++;
        y++;
      }
      frontier.set(diagonal, x);
      if (x >= before.length && y >= after.length)
        return backtrack(trace, before, after, distance);
    }
  }
  return [];
}
function backtrack(trace, before, after, distance) {
  const result = [];
  let x = before.length;
  let y = after.length;
  for (let depth = distance; depth >= 0; depth--) {
    const frontier = trace[depth];
    const diagonal = x - y;
    const down = frontier.get(diagonal + 1) ?? -1;
    const right = frontier.get(diagonal - 1) ?? -1;
    const previousDiagonal = diagonal === -depth || diagonal !== depth && right < down ? diagonal + 1 : diagonal - 1;
    const previousX = Math.max(0, frontier.get(previousDiagonal) ?? 0);
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      result.push({ kind: "equal", line: before[x - 1] });
      x--;
      y--;
    }
    if (depth === 0) break;
    if (x === previousX) {
      result.push({ kind: "insert", line: after[y - 1] });
      y--;
    } else {
      result.push({ kind: "delete", line: before[x - 1] });
      x--;
    }
  }
  return result.reverse();
}

// src/index.ts
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
      this,
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
      import_coc.commands.registerCommand(
        "coc-diffview.openFileChange",
        (root, relative, base = "HEAD", target = "WORKTREE") => this.openFile(createDiffFile(root, relative, base, target))
      ),
      import_coc.commands.registerCommand(
        "coc-diffview.openFileUnified",
        (root, relative, base = "HEAD", target = "WORKTREE") => this.openUnified(createDiffFile(root, relative, base, target))
      ),
      import_coc.commands.registerCommand(
        "coc-diffview.openFileSplit",
        (root, relative, base = "HEAD", target = "WORKTREE") => this.openSplit(createDiffFile(root, relative, base, target))
      ),
      import_coc.commands.registerCommand("coc-diffview.close", () => this.close()),
      import_coc.events.on("TextChanged", (bufnr) => this.scheduleRender(bufnr)),
      import_coc.events.on("TextChangedI", (bufnr) => this.scheduleRender(bufnr)),
      import_coc.events.on("TextChangedP", (bufnr) => this.scheduleRender(bufnr))
    );
  }
  files = new DiffFilesProvider();
  history = new FileHistoryProvider();
  session;
  dispose() {
    if (this.session?.kind === "unified" && this.session.refreshTimer)
      clearTimeout(this.session.refreshTimer);
  }
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
    await this.showFiles(root, `${hash}^`, hash);
  }
  async showFiles(root, base, target) {
    const args = target === "WORKTREE" ? ["diff", "--name-status", base] : ["diff", "--name-status", base, target];
    const output = await this.git.diff(root, args);
    this.files.set(parseFiles(output, root, base, target));
    await this.ui.showView("diff.files");
  }
  async openFile(file) {
    const layout = import_coc.workspace.getConfiguration("coc-diffview").get("layout", "unified");
    if (layout === "split") await this.openSplit(file);
    else await this.openUnified(file);
  }
  async openUnified(file) {
    await this.close();
    const base = splitLines(
      await this.fileContents(file.root, file.base, file.basePath)
    );
    const target = await this.fileContents(file.root, file.target, file.path);
    const editor = await this.editorWindow();
    if (!editor) return;
    await import_coc.workspace.nvim.call("win_gotoid", [editor]);
    const buffer = await this.openTarget(file, target);
    const windowId = await import_coc.workspace.nvim.call("win_getid");
    const namespace = await import_coc.workspace.nvim.call("nvim_create_namespace", [
      "coc-diffview-unified"
    ]);
    this.session = {
      kind: "unified",
      window: windowId,
      buffer,
      namespace,
      baseLines: base
    };
    await this.renderUnified(this.session);
  }
  async openSplit(file) {
    await this.close();
    const left = await this.fileContents(file.root, file.base, file.basePath);
    const right = await this.fileContents(file.root, file.target, file.path);
    const editor = await this.editorWindow();
    if (!editor) return;
    await import_coc.workspace.nvim.call("win_gotoid", [editor]);
    await this.openTarget(file, right);
    const rightWindow = await import_coc.workspace.nvim.call("win_getid");
    await import_coc.workspace.nvim.command("leftabove vsplit");
    const leftWindow = await import_coc.workspace.nvim.call("win_getid");
    const leftBuffer = await this.scratchBuffer(file.base, file.basePath, left);
    await import_coc.workspace.nvim.call("nvim_win_set_buf", [leftWindow, leftBuffer]);
    await import_coc.workspace.nvim.command(
      "setlocal buftype=nofile bufhidden=wipe noswapfile nomodifiable"
    );
    await import_coc.workspace.nvim.command("diffthis");
    await import_coc.workspace.nvim.command("setlocal scrollbind cursorbind");
    await import_coc.workspace.nvim.call("win_gotoid", [rightWindow]);
    await import_coc.workspace.nvim.command("diffthis");
    await import_coc.workspace.nvim.command("setlocal scrollbind cursorbind");
    this.session = { kind: "split", leftWindow, rightWindow };
  }
  async openTarget(file, contents) {
    if (file.target === "WORKTREE") {
      await this.ui.openLocation(
        import_coc.Uri.file(import_node_path.default.join(file.root, file.path)).toString(),
        0,
        0
      );
      return await import_coc.workspace.nvim.call("bufnr", ["%"]);
    }
    const buffer = await this.scratchBuffer(file.target, file.path, contents);
    await import_coc.workspace.nvim.call("nvim_win_set_buf", [0, buffer]);
    await import_coc.workspace.nvim.command("setlocal buftype=nofile bufhidden=wipe noswapfile");
    return buffer;
  }
  async scratchBuffer(ref, relative, contents) {
    const buffer = await import_coc.workspace.nvim.call("nvim_create_buf", [
      false,
      true
    ]);
    await import_coc.workspace.nvim.call("nvim_buf_set_name", [
      buffer,
      `coc-diffview://${ref}/${relative}`
    ]);
    await import_coc.workspace.nvim.call("nvim_buf_set_lines", [
      buffer,
      0,
      -1,
      false,
      splitLines(contents)
    ]);
    await import_coc.workspace.nvim.call("nvim_buf_set_option", [buffer, "modified", false]);
    return buffer;
  }
  scheduleRender(bufnr) {
    const session = this.session;
    if (session?.kind !== "unified" || session.buffer !== bufnr) return;
    if (session.refreshTimer) clearTimeout(session.refreshTimer);
    session.refreshTimer = setTimeout(() => {
      session.refreshTimer = void 0;
      if (this.session === session) void this.renderUnified(session);
    }, 80);
  }
  async renderUnified(session) {
    const valid = await import_coc.workspace.nvim.call("nvim_buf_is_valid", [
      session.buffer
    ]);
    if (!valid || this.session !== session) return;
    const current = await import_coc.workspace.nvim.call("nvim_buf_get_lines", [
      session.buffer,
      0,
      -1,
      false
    ]);
    await import_coc.workspace.nvim.call("nvim_buf_clear_namespace", [
      session.buffer,
      session.namespace,
      0,
      -1
    ]);
    for (const change of lineChanges(session.baseLines, current)) {
      if (change.removed.length) {
        const atEnd = change.newStart >= current.length;
        const row = atEnd ? Math.max(0, current.length - 1) : change.newStart;
        await import_coc.workspace.nvim.call("nvim_buf_set_extmark", [
          session.buffer,
          session.namespace,
          row,
          0,
          {
            virt_lines: change.removed.map((line) => [[line, "DiffDelete"]]),
            virt_lines_above: !atEnd,
            virt_lines_leftcol: true
          }
        ]);
      }
      if (change.added.length) {
        await import_coc.workspace.nvim.call("nvim_buf_set_extmark", [
          session.buffer,
          session.namespace,
          change.newStart,
          0,
          {
            end_row: change.newStart + change.added.length,
            hl_group: change.removed.length ? "DiffChange" : "DiffAdd",
            hl_eol: true
          }
        ]);
      }
    }
  }
  async close() {
    const session = this.session;
    if (!session) return;
    this.session = void 0;
    if (session.kind === "unified") {
      if (session.refreshTimer) clearTimeout(session.refreshTimer);
      const valid = await import_coc.workspace.nvim.call("nvim_buf_is_valid", [
        session.buffer
      ]);
      if (valid)
        await import_coc.workspace.nvim.call("nvim_buf_clear_namespace", [
          session.buffer,
          session.namespace,
          0,
          -1
        ]);
      return;
    }
    for (const windowId of [session.leftWindow, session.rightWindow]) {
      const valid = await import_coc.workspace.nvim.call("nvim_win_is_valid", [
        windowId
      ]);
      if (!valid) continue;
      await import_coc.workspace.nvim.call("win_gotoid", [windowId]);
      await import_coc.workspace.nvim.command("diffoff");
      await import_coc.workspace.nvim.command("setlocal noscrollbind nocursorbind");
    }
    const leftValid = await import_coc.workspace.nvim.call("nvim_win_is_valid", [
      session.leftWindow
    ]);
    if (leftValid)
      await import_coc.workspace.nvim.call("nvim_win_close", [session.leftWindow, true]);
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
        return "";
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
function createDiffFile(root, relative, base, target) {
  return { root, path: relative, basePath: relative, status: "", base, target };
}
function parseFiles(output, root, base, target) {
  return output.split("\n").filter(Boolean).map((line) => {
    const [status, ...parts] = line.split("	");
    const renamed = status.startsWith("R") || status.startsWith("C");
    const filePath = parts.at(-1);
    return {
      root,
      status,
      path: filePath,
      basePath: renamed ? parts[0] : filePath,
      base,
      target
    };
  });
}
function splitLines(contents) {
  const lines = contents.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length ? lines : [""];
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
