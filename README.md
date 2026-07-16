# coc-diffview

Git diff and file-history views for coc.nvim. The file list and file history
are mounted together in a panel View Container supplied by
`@statiolake/coc-ui`.

Selecting a file opens a VS Code-style unified diff by default. The target is
the editable buffer; removed lines are virtual and the annotations are
recomputed after every buffer change without moving the cursor. Set
`coc-diffview.layout` to `split` for a two-pane Neovim diff with synchronized
scrolling, or use `coc-diffview.openFileUnified` and
`coc-diffview.openFileSplit` to choose explicitly.
