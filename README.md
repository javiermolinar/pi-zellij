# pi-zellij

Pi package with zellij-powered terminal integrations for [Pi](https://pi.dev).

## Why

[Pi](https://pi.dev) works well in the terminal, but pane orchestration is better handled by a terminal multiplexer. `pi-zellij` adds zellij-native split workflows for Pi, plus optional desktop notifications.

It includes split and tab commands, generic tool launchers, settings-driven floating app shortcuts, zoxide jumps, review workflows, split-based task handoff, and automatic run notifications.

## Usage

Install with pi:

```bash
pi install npm:pi-zellij
```

Or with the installer:

```bash
npx pi-zellij
```

If pi is already running, use:

```text
/reload
```

## Requirements

- `zellij` must be installed
- pane, tab, and floating commands must be run from inside an active zellij session
- `zoxide` is required for the zoxide commands
- notifications use:
  - `osascript` on macOS
  - `notify-send` on Linux

## Feature overview

### Pane and tab workflows

- `/zv`, `/zj`, `/zt`
  - start a fresh Pi session in a new right pane, lower pane, or tab
- `/zo <command...>`, `/zoh <command...>`
  - run any shell command in a new right pane or lower pane
- `/zz <query>`, `/zzh <query>`
  - jump to a zoxide match or direct directory path and start Pi there

### Floating tools

- `pi-zellij.commands` in `settings.json`
  - registers floating app shortcuts such as `/zh` for `hx` or `/zg` for `lazygit`

### Review and handoff workflows

- `/zcv`, `/zch`
  - open continuation sessions in a split, optionally in a new git worktree
- `/review <target>`, `/review-diff [focus-or-pr-url]`
  - expand bundled review prompts in the current pane
- `/zrv`, `/zrh`, plus review flags
  - open review-focused Pi sessions in a split
- `/skill:code-review`
  - loads the bundled structured review skill for files, directories, diffs, and PRs

### Notifications

- automatic via `zv-notify`
  - sends desktop notifications for Pi run states such as `Waiting`, `Task Complete`, and `Error`

## Bundled extensions and resources

Extensions:
- `zv-notify`
- `zv-split`
- `zv-open`
- `zv-zoxide`
- `zv-review`
- `zv-continue`

Other bundled resources:
- `code-review` skill
- `/review` prompt template
- `/review-diff` prompt template

## Commands

### Split and tab commands

- `/zv`
  - opens a new pane to the right
  - starts a fresh `pi` session in the same `cwd`
- `/zj`
  - opens a new pane below
  - starts a fresh `pi` session in the same `cwd`
- `/zt`
  - opens a new zellij tab
  - starts a fresh `pi` session in the same `cwd`

All three commands also accept optional initial prompt text.

Examples:

```text
/zv Review the auth flow in this repo
/zt Investigate flaky tests in this repo
```

### Tool split commands

- `/zo <command...>`
  - opens a new pane to the right
  - runs the given shell command in the same `cwd`
- `/zoh <command...>`
  - opens a new pane below
  - runs the given shell command in the same `cwd`

Examples:

```text
/zo hx
/zo npm test
/zoh npm run dev
/zo watch -n 1 git status --short
```

Commands are executed via `sh -lc` in the current project directory.

### Configured floating commands

You can register your own floating app shortcuts in Pi's main settings file under `pi-zellij.commands`.

Supported locations:
- `~/.pi/agent/settings.json` for global commands
- `.pi/settings.json` for project-local commands

During the rename from `pi-zv` to `pi-zellij`, legacy `pi-zv.commands` is still accepted for compatibility. If both keys exist, `pi-zellij.commands` wins.

Simple form:

```json
{
  "pi-zellij": {
    "commands": {
      "zh": "hx",
      "zg": "lazygit"
    }
  }
}
```

Each configured command opens in a floating zellij pane using a default `90%` by `90%` popup with `5%` margins.

Examples:

```text
/zh
/zg
```

For commands that should accept extra arguments, use the object form.

Helix and lazygit example:

```json
{
  "pi-zellij": {
    "commands": {
      "zh": {
        "run": "hx",
        "acceptArgs": true,
        "description": "Open Helix in a floating pane"
      },
      "zg": {
        "run": "lazygit",
        "description": "Open lazygit in a floating pane"
      }
    }
  }
}
```

Then you can use:

```text
/zh
/zh src/auth.ts
/zg
```

Configured command names cannot reuse built-in Pi commands such as `/settings`, `/model`, or `/reload`, and they also cannot replace pi-zellij's own slash commands such as `/zv`, `/zj`, `/zt`, `/zz`, or `/zcv`.

If the same command exists in both global and project settings, the project setting wins. After changing settings, run `/reload` in Pi.

### Zoxide jump commands

- `/zz <query>`
  - resolves the query with `zoxide query`
  - opens a new pane to the right
  - starts a fresh pi session in the matched directory
- `/zzh <query>`
  - resolves the query with `zoxide query`
  - opens a new pane below
  - starts a fresh pi session in the matched directory

Example:

```text
/zz mono
```

If the argument is already a valid directory path, `/zz` and `/zzh` use it directly instead of querying zoxide.

### Continuation and worktree helpers

- `/zcv`
  - opens a new pane to the right
  - creates a related handoff session in the current checkout
- `/zch`
  - opens a new pane below
  - creates a related handoff session in the current checkout
- `/zcv <note>` / `/zch <note>`
  - same as above, but adds a focus note to the handoff context
- `/zcv -c <branch>` / `/zch -c <branch>`
  - creates a new branch worktree from the current `HEAD`, then opens a new pane there
- `/zcv -c <branch> --from <ref>` / `/zch -c <branch> --from <ref>`
  - creates a new branch worktree from an explicit base ref such as `main` or `origin/main`
- `/zcv -c <branch> [--from <ref>] <note...>` / `/zch -c <branch> [--from <ref>] <note...>`
  - same as above, but also adds a focus note to the worktree handoff

Examples:

```text
/zcv
/zcv focus on tests
/zcv -c fix/notify-bug
/zcv -c fix/notify-bug --from main
/zcv -c fix/notify-bug --from main review the existing changes first
/zch -c feature/review-ui focus on edge cases
```

### Review helpers

`pi-zellij` also bundles a reusable `code-review` skill plus prompt templates for in-place review:

- `/review <target>`
  - prompt template for reviewing a file, directory, or GitHub pull request URL in the current pane
- `/review-diff [focus-or-pr-url]`
  - prompt template for reviewing the current git diff in the current pane, or a GitHub pull request URL via `gh`

Split review commands:

- `/zrv`
  - with no arguments, reviews the current git diff in a new right pane
- `/zrh`
  - with no arguments, reviews the current git diff in a new lower pane
- `/zrv [--bugs|--refactor|--tests] <target>` or `/zrv --diff [focus]`
  - opens a new pane to the right
  - starts a fresh pi review session in the same `cwd`
- `/zrh [--bugs|--refactor|--tests] <target>` or `/zrh --diff [focus]`
  - opens a new pane below
  - starts a fresh pi review session in the same `cwd`

`--diff` is the default, so `/zrv` and `/zrh` usually do not need the flag.

There are no `/review-v` or `/review-h` aliases in `pi-zellij`, so it can coexist more cleanly with other Pi packages.

Examples:

```text
/zrv
/zrh
/zrv src/auth.ts
/zrv --bugs src/auth.ts
/zrh --refactor src/auth/
/zrv --diff
/zrh --diff focus on token refresh and retries
/zrv https://github.com/owner/repo/pull/123
```

If the target is a GitHub pull request URL, the review workflow switches to PR review and instructs pi to inspect the pull request with `gh pr view` and `gh pr diff`.

## Notifications

The bundled `zv-notify` extension summarizes each run and sends a desktop notification when supported by the host system.

Current notification types:
- `Waiting`
- `Task Complete`
- `Error`

You can control notification noise with one setting:
- `PI_ZV_NOTIFY_LEVEL=all` - `Waiting`, `Task Complete`, and `Error`
- `PI_ZV_NOTIFY_LEVEL=medium` - `Task Complete` and `Error`
- `PI_ZV_NOTIFY_LEVEL=low` - `Error` only
- `PI_ZV_NOTIFY_LEVEL=disabled` - disable notifications

## Environment variables

- `PI_ZV_NOTIFY_LEVEL` - notification level: `all`, `medium`, `low`, or `disabled` (default: `all`)
- `PI_ZV_NOTIFY_THRESHOLD_MS` - duration threshold before a run is labeled `Task Complete` instead of `Waiting` (default: `15000`)
- `PI_ZV_NOTIFY_DEBOUNCE_MS` - minimum delay between duplicate notifications (default: `3000`)
- `PI_ZV_NOTIFY_TITLE` - notification title override (default: `Pi`)
