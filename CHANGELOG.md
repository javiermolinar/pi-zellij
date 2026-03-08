# Changelog

## [Unreleased]

### Added

- Initial `pi-zellij` release with zellij-powered pane workflows for Pi.

### Changed

- Clarified README notification wording to match the current `zv-notify` behavior: `Waiting`, `Task Complete`, and `Error`.
- Added `zv-notify` for desktop notifications using `osascript` on macOS or `notify-send` on Linux.
- Added `/zv`, `/zj`, and `/zt` to open a new zellij pane or tab and start a fresh Pi session in the same working directory.
- Added `/zo` and `/zoh` to open a new pane and run any shell command there.
- Added configurable floating app commands via `pi-zellij.commands` in Pi `settings.json`, including shorthand entries such as `"zh": "hx"` and `"zg": "lazygit"`, plus object entries with `acceptArgs` support.
- Added compatibility fallback for legacy `pi-zv.commands` settings during the rename to `pi-zellij`.
- Reserved Pi built-in slash commands such as `/settings`, `/model`, and `/reload` so configured floating commands cannot shadow them.
- Added `/zz` and `/zzh` to open a new pane from a zoxide match or direct directory path and start Pi there.
- Added `zv-review` with `/zrv` and `/zrh`, plus bundled `code-review` skill and `/review` / `/review-diff` prompt templates for focused review workflows, including GitHub pull request review via `gh` when given a PR URL.
- Added `zv-continue` with `/zcv` and `/zch` for split-based task handoff in the current checkout or by creating a git worktree branch with `-c <branch>`.
