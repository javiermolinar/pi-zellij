# AGENTS.md

## Repo overview

This repository contains `pi-zellij`, a small Pi package that adds zellij-powered terminal workflows to Pi.

Current extensions:
- `extensions/zv-split.ts` — adds split and tab commands that open a new zellij pane or tab and start a fresh Pi session in the same working directory
- `extensions/zv-open.ts` — adds generic shell split commands plus configurable floating app shortcuts from settings
- `extensions/zv-zoxide.ts` — adds zoxide-based pane commands that jump to a matched directory and start Pi there
- `extensions/zv-review.ts` — adds split review commands for diffs, files, directories, and GitHub pull requests
- `extensions/zv-continue.ts` — adds split-based continuation and worktree handoff commands

Other important files:
- `README.md` — user-facing package documentation
- `CHANGELOG.md` — unreleased and released changes
- `install.mjs` — installer/removal entrypoint used by `npx pi-zellij`
- `package.json` — package metadata for npm and Pi

## How the repo works

- This is a TypeScript-based Pi package, but the repo currently does not include a local TypeScript toolchain or build step.
- Extensions are loaded from `./extensions` via the `pi.extensions` entry in `package.json`.
- The package is published to npm and installed in Pi via `pi install npm:pi-zellij` or `npx pi-zellij`.

## Editing guidelines

- Keep README examples and behavior descriptions aligned with the extension behavior.
- Update `CHANGELOG.md` for user-visible changes.
- Prefer small, focused edits.
- Preserve the existing style: concise docs, simple utilities, minimal dependencies.

## Release / push checklist

Before pushing changes:
- bump the npm version
- update `CHANGELOG.md` if behavior changed
- make sure `README.md` matches the current behavior
- review the git diff for accidental changes

## Notes for future agents

- There is currently no local `tsc` dependency in this repo, so TypeScript validation may not be available unless TypeScript is installed separately.
- If you change publishable package metadata or release behavior, check `package.json`, `README.md`, and `CHANGELOG.md` together.
