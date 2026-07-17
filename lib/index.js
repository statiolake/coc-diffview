"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  activate: () => activate
});
module.exports = __toCommonJS(index_exports);
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
var Diffview = class {
  session;
  nextBufferId = 1;
  constructor(context) {
    context.subscriptions.push(
      this,
      import_coc.commands.registerCommand(
        "coc-diffview.open",
        (options) => this.open(options)
      ),
      import_coc.commands.registerCommand("coc-diffview.close", () => this.close()),
      import_coc.events.on("TextChanged", (bufnr) => this.scheduleRender(bufnr)),
      import_coc.events.on("TextChangedI", (bufnr) => this.scheduleRender(bufnr)),
      import_coc.events.on("TextChangedP", (bufnr) => this.scheduleRender(bufnr))
    );
  }
  dispose() {
    const session = this.session;
    this.session = void 0;
    if (session?.kind === "unified" && session.refreshTimer)
      clearTimeout(session.refreshTimer);
  }
  async open(options) {
    validateOptions(options);
    const layout = options.layout ?? import_coc.workspace.getConfiguration("coc-diffview").get("layout", "unified");
    if (layout === "split") await this.openSplit(options);
    else await this.openUnified(options);
  }
  async close() {
    const session = this.session;
    if (!session) return;
    this.session = void 0;
    if (session.kind === "unified") {
      if (session.refreshTimer) clearTimeout(session.refreshTimer);
      if (await bufferIsValid(session.buffer)) {
        await import_coc.workspace.nvim.call("nvim_buf_clear_namespace", [
          session.buffer,
          session.namespace,
          0,
          -1
        ]);
      }
      if (await windowIsValid(session.window)) {
        await import_coc.workspace.nvim.call("nvim_set_option_value", [
          "signcolumn",
          session.signColumn,
          { win: session.window }
        ]);
      }
    } else {
      for (const windowId of [session.leftWindow, session.rightWindow]) {
        if (!await windowIsValid(windowId)) continue;
        await import_coc.workspace.nvim.call("win_gotoid", [windowId]);
        await import_coc.workspace.nvim.command("diffoff");
        await import_coc.workspace.nvim.command("setlocal noscrollbind nocursorbind");
      }
      if (await windowIsValid(session.leftWindow))
        await import_coc.workspace.nvim.call("nvim_win_close", [session.leftWindow, true]);
    }
    for (const buffer of session.createdBuffers) {
      if (await bufferIsValid(buffer))
        await import_coc.workspace.nvim.call("nvim_buf_delete", [buffer, { force: true }]);
    }
  }
  async openUnified(options) {
    await this.close();
    const originalLines = await this.readSource(options.original);
    const editor = await this.editorWindow();
    if (!editor) return;
    const createdBuffers = [];
    await import_coc.workspace.nvim.call("win_gotoid", [editor]);
    const buffer = await this.openModified(options.modified, createdBuffers);
    const windowId = await import_coc.workspace.nvim.call("win_getid");
    const signColumn = await import_coc.workspace.nvim.call("nvim_get_option_value", [
      "signcolumn",
      { win: windowId }
    ]);
    await import_coc.workspace.nvim.call("nvim_set_option_value", [
      "signcolumn",
      "yes",
      { win: windowId }
    ]);
    const namespace = await import_coc.workspace.nvim.call("nvim_create_namespace", [
      "coc-diffview-unified"
    ]);
    this.session = {
      kind: "unified",
      window: windowId,
      buffer,
      namespace,
      originalLines,
      signColumn,
      createdBuffers
    };
    await this.renderUnified(this.session);
  }
  async openSplit(options) {
    await this.close();
    const editor = await this.editorWindow();
    if (!editor) return;
    const createdBuffers = [];
    await import_coc.workspace.nvim.call("win_gotoid", [editor]);
    await this.openModified(options.modified, createdBuffers);
    const rightWindow = await import_coc.workspace.nvim.call("win_getid");
    await import_coc.workspace.nvim.command("leftabove vsplit");
    const leftWindow = await import_coc.workspace.nvim.call("win_getid");
    const original = await this.snapshotBuffer(options.original);
    createdBuffers.push(original);
    await import_coc.workspace.nvim.call("nvim_win_set_buf", [leftWindow, original]);
    await import_coc.workspace.nvim.command(
      "setlocal buftype=nofile bufhidden=wipe noswapfile nomodifiable"
    );
    await import_coc.workspace.nvim.command("diffthis");
    await import_coc.workspace.nvim.command("setlocal scrollbind cursorbind");
    await import_coc.workspace.nvim.call("win_gotoid", [rightWindow]);
    await import_coc.workspace.nvim.command("diffthis");
    await import_coc.workspace.nvim.command("setlocal scrollbind cursorbind");
    this.session = {
      kind: "split",
      leftWindow,
      rightWindow,
      createdBuffers
    };
  }
  async openModified(source, createdBuffers) {
    if (source.kind === "buffer") {
      if (!await bufferIsValid(source.buffer))
        throw new Error(`Invalid modified buffer: ${source.buffer}`);
      await import_coc.workspace.nvim.call("nvim_win_set_buf", [0, source.buffer]);
      return source.buffer;
    }
    const buffer = await this.textBuffer(source, true);
    createdBuffers.push(buffer);
    await import_coc.workspace.nvim.call("nvim_win_set_buf", [0, buffer]);
    return buffer;
  }
  async snapshotBuffer(source) {
    const lines = await this.readSource(source);
    return this.textBuffer(
      {
        kind: "text",
        text: lines.join("\n"),
        label: source.label ?? "original",
        filetype: await this.sourceFiletype(source)
      },
      false
    );
  }
  async textBuffer(source, modifiable) {
    const buffer = await import_coc.workspace.nvim.call("nvim_create_buf", [
      false,
      true
    ]);
    const label = source.label.replaceAll("/", "_");
    await import_coc.workspace.nvim.call("nvim_buf_set_name", [
      buffer,
      `coc-diffview://${this.nextBufferId++}/${label}`
    ]);
    await import_coc.workspace.nvim.call("nvim_buf_set_lines", [
      buffer,
      0,
      -1,
      false,
      splitLines(source.text)
    ]);
    if (source.filetype)
      await import_coc.workspace.nvim.call("nvim_set_option_value", [
        "filetype",
        source.filetype,
        { buf: buffer }
      ]);
    await import_coc.workspace.nvim.call("nvim_set_option_value", [
      "buftype",
      "nofile",
      { buf: buffer }
    ]);
    await import_coc.workspace.nvim.call("nvim_set_option_value", [
      "bufhidden",
      "wipe",
      { buf: buffer }
    ]);
    await import_coc.workspace.nvim.call("nvim_set_option_value", [
      "swapfile",
      false,
      { buf: buffer }
    ]);
    await import_coc.workspace.nvim.call("nvim_set_option_value", [
      "modified",
      false,
      { buf: buffer }
    ]);
    await import_coc.workspace.nvim.call("nvim_set_option_value", [
      "modifiable",
      modifiable,
      { buf: buffer }
    ]);
    return buffer;
  }
  async readSource(source) {
    if (source.kind === "text") return splitLines(source.text);
    if (!await bufferIsValid(source.buffer))
      throw new Error(`Invalid diff buffer: ${source.buffer}`);
    return await import_coc.workspace.nvim.call("nvim_buf_get_lines", [
      source.buffer,
      0,
      -1,
      false
    ]);
  }
  async sourceFiletype(source) {
    if (source.kind === "text") return source.filetype;
    return await import_coc.workspace.nvim.call("nvim_get_option_value", [
      "filetype",
      { buf: source.buffer }
    ]);
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
    if (!await bufferIsValid(session.buffer) || this.session !== session) return;
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
    const windowInfo = await import_coc.workspace.nvim.call("getwininfo", [
      session.window
    ]);
    const textOffset = windowInfo[0]?.textoff ?? 0;
    for (const change of lineChanges(session.originalLines, current)) {
      if (change.removed.length) {
        const atEnd = change.newStart >= current.length;
        const row = atEnd ? Math.max(0, current.length - 1) : change.newStart;
        await import_coc.workspace.nvim.call("nvim_buf_set_extmark", [
          session.buffer,
          session.namespace,
          row,
          0,
          {
            virt_lines: change.removed.map(
              (line) => removedVirtualLine(line, textOffset)
            ),
            virt_lines_above: !atEnd,
            virt_lines_leftcol: true
          }
        ]);
      }
      if (change.added.length) {
        const highlight = change.removed.length ? "Changed" : "Added";
        for (let row = change.newStart; row < change.newStart + change.added.length; row++) {
          await import_coc.workspace.nvim.call("nvim_buf_set_extmark", [
            session.buffer,
            session.namespace,
            row,
            0,
            { sign_text: "\u2503", sign_hl_group: highlight }
          ]);
        }
      }
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
    return windows[0];
  }
};
function validateOptions(options) {
  if (!options?.original || !options.modified)
    throw new Error("coc-diffview.open requires original and modified sources");
}
function removedVirtualLine(line, textOffset) {
  return [
    [" ".repeat(Math.max(0, textOffset - 1)), "Normal"],
    ["\u2503", "Removed"],
    [line, "Normal"]
  ];
}
function splitLines(contents) {
  const lines = contents.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length ? lines : [""];
}
async function bufferIsValid(buffer) {
  return await import_coc.workspace.nvim.call("nvim_buf_is_valid", [buffer]);
}
async function windowIsValid(window) {
  return await import_coc.workspace.nvim.call("nvim_win_is_valid", [window]);
}
async function activate(context) {
  return new Diffview(context);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate
});
//# sourceMappingURL=index.js.map
