---
description: Review the current git diff for regressions and missing tests
---
Use the bundled `code-review` skill if it is available.

Review the current git diff in this repository. If `${@:1}` is a GitHub pull request URL, inspect that pull request instead using `gh pr view <url>` and `gh pr diff <url>`. ${@:1} Prioritize regressions, correctness issues, risky edge cases, and missing tests.

Start with a concise summary ordered by severity. Then list concrete findings with suggested fixes. Do not edit files unless asked.
