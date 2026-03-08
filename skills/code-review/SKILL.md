---
name: code-review
description: Structured code review workflow for files, directories, and git diffs. Use when reviewing code for bugs, regressions, maintainability, missing tests, or refactor opportunities.
---

# Code Review

Use this skill for targeted code review requests, including file reviews, module reviews, and current diff reviews.

## Review goals

- Find the most important issues first.
- Prefer concrete, evidence-based findings over broad stylistic commentary.
- Call out missing tests or risky edge cases when they matter.
- Do not edit files unless the user explicitly asks for changes.

## Review modes

Infer the mode from the user request:
- **General review** — correctness, readability, maintainability, and missing tests
- **Bug-focused review** — correctness, runtime failures, invalid assumptions, edge cases, regressions
- **Refactor review** — simplification, structure, naming, duplication, cohesion, maintainability
- **Test review** — missing coverage, brittle assertions, edge cases, regression protection
- **Diff review** — review the current git diff or requested change set for regressions and missing validation
- **GitHub PR review** — when given a GitHub pull request URL, inspect it with `gh pr view` and `gh pr diff` before concluding

## Workflow

1. Identify the exact review scope.
   - If the user named a file, directory, symbol, or diff, stick to that scope.
   - If the scope is ambiguous, ask one concise clarifying question.

2. Inspect the relevant code before concluding.
   - Read the relevant files or inspect the diff.
   - For GitHub pull request URLs, use `gh pr view <url>` and `gh pr diff <url>` to inspect the change.
   - Follow nearby code only when needed to confirm behavior or impact.

3. Prioritize findings.
   - Lead with issues that can cause incorrect behavior, regressions, security problems, crashes, or data loss.
   - Lower-priority maintainability notes should come after correctness issues.

4. Summarize succinctly.
   - Start with a short summary ordered by severity.
   - If there are no meaningful issues, say so clearly.

5. Make findings actionable.
   - For each finding, explain:
     - what is wrong
     - why it matters
     - where it occurs
     - what change would improve it

## Output format

Use this structure unless the user asked for something else:

```md
Summary
- <highest-severity finding or "No major issues found">
- <next item>

Findings
1. Severity: <high|medium|low>
   - Location: <file or diff area>
   - Issue: <what is wrong>
   - Impact: <why it matters>
   - Fix: <concrete suggestion>

2. ...

Test gaps
- <missing test or "None noted">
```

## Guardrails

- Do not invent behavior you did not inspect.
- Do not pad the review with weak style nits.
- Prefer a small number of strong findings over a long noisy list.
- If the review target is large, focus on the most relevant files first and say what you sampled.
- If you are uncertain, state the uncertainty explicitly.
