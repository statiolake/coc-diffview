# coc-diffview

Editable unified and side-by-side diff UI for coc.nvim.

`coc-diffview` deliberately has no knowledge of Git, repositories, revisions,
or file history. Extensions such as `coc-git` resolve the two documents and
pass them to this extension as an `original` and a `modified` source.

The modified source remains editable. When it is an existing buffer, edits are
made directly in that buffer. Unified annotations are recomputed after every
buffer change without moving the cursor. Split views use Neovim's diff mode and
synchronize scrolling and cursor movement.

## API

```ts
import type { CocDiffviewApi } from "@statiolake/coc-diffview";

await diffview.open({
  original: {
    kind: "text",
    text: contentsAtHead,
    label: "HEAD:src/index.ts",
    filetype: "typescript",
  },
  modified: {
    kind: "buffer",
    buffer: bufnr,
    label: "src/index.ts",
  },
  layout: "unified", // or "split"
});
```

Both sources accept `{ kind: "buffer", buffer }` or
`{ kind: "text", text, label, filetype? }`. A text modified source is an
editable scratch buffer; a buffer modified source edits the real document.

The `coc-diffview.open` command accepts the same options object. Use
`coc-diffview.close` to remove the active diff session.

- `coc-diffview.toggleLayout` switches the active diff between unified and
  side-by-side layouts.
- `coc-diffview.toggle` switches between the diff and the normal modified
  buffer. It reopens the most recent diff when invoked again.

Unified added, removed, and changed lines use `CocDiffviewAdded`,
`CocDiffviewRemoved`, and `CocDiffviewChanged`. They default to `DiffAdd`,
`DiffDelete`, and `DiffChange`, matching Neovim's side-by-side diff colors.
