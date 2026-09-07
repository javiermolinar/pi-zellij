# Changelog

## [Unreleased]

### Added

- Added optional `pi-zellij.review.skill` settings for `/zrv` and `/zrh` to use an existing loaded skill, with project overrides and errors for unavailable or unreadable skills.
- Initial `pi-zellij` release with zellij-powered pane workflows for Pi.
- Added `/zv`, `/zj`, and `/zt` to open a new zellij pane or tab and start a fresh Pi session in the same working directory.
- Added `/zo` and `/zoh` to open a new pane and run any shell command there.
- Added configurable floating app commands via `pi-zellij.commands` in Pi `settings.json`, including shorthand entries such as `"zh": "hx"` and `"zg": "lazygit"`, plus object entries with `acceptArgs` support.
- Added compatibility fallback for legacy `pi-zv.commands` settings during the rename to `pi-zellij`.
- Reserved Pi built-in slash commands such as `/settings`, `/model`, and `/reload` so configured floating commands cannot shadow them.
- Added `/zz` and `/zzh` to open a new pane from a zoxide match or direct directory path and start Pi there.
- Added `zv-review` with `/zrv` and `/zrh`, plus bundled `code-review` skill and `/review` / `/review-diff` prompt templates for focused review workflows, including GitHub pull request review via `gh` when given a PR URL.
- Added `zv-continue` with `/zcv` and `/zch` for split-based task handoff in the current checkout or by creating a git worktree branch with `-c <branch>`.
- Added opt-in `paneHighlight` settings so Pi can tint the current zellij pane when an agent turn completes, with optional working-state colors.
- Added an agent-facing `zellij_open_terminal` tool so Pi can open explicitly requested interactive terminal commands in right or lower splits, tabs, and floating panes.
- Added an agent-facing `zellij_start_pi` tool for fresh Pi sessions in right or lower splits and tabs, with optional initial prompts, model settings, pane titles, and explicit history inheritance through a separate cloned session.

### Changed

- `/zrv` and `/zrh` now use self-contained review instructions by default, injected only into the new review session. `/review` and `/review-diff` no longer refer to a bundled skill.
- Explicit history inheritance now rejects branches with no conversation messages before creating a cloned session or opening a pane.
- Expanded `zellij_open_terminal` prompt guidance so agents recognize requests to start another Pi session and prefer the dedicated `zellij_start_pi` interface when available.
- Pi launch command construction now supports quoted provider, model, and thinking options and stops option parsing before initial prompts.
- When zellij reports created pane or tab IDs, `pi-zellij` now shows them in success notifications for split, floating, zoxide, review, continuation, and tab commands.
- `/zt` now uses `zellij action new-tab -- <command>` when available instead of always simulating typed input, while keeping the previous typed-input path as a compatibility fallback.
- Pane highlights now clear on the next submitted input or when the pane is focused again after being elsewhere, instead of waiting for the next agent start event. Aborted runs no longer apply the done-state tint.
- Pane focus polling no longer writes transient zellij query timeout warnings into the Pi editor; refocus-based clearing is skipped if focus state cannot be queried reliably.
- Done-state pane tint is now only applied while the Pi pane is unfocused, so the editor is reset immediately instead of staying green while typing in the active pane.

### Removed

- Removed the bundled `code-review` skill from the package and installer so terminal workflows do not register a global review skill.
- Removed the bundled `zv-notify` extension so `pi-zellij` does not conflict with separate notification packages or user-specific notification setups.
