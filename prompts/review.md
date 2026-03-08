---
description: Review a file or directory for bugs, maintainability issues, and missing tests
---
Use the bundled `code-review` skill if it is available.

Review `$1` from the current project. If the target is a GitHub pull request URL, inspect it with `gh pr view <url>` and `gh pr diff <url>`. Focus on correctness, readability, maintainability, and missing tests. If the target is a directory, review the most relevant files within that scope.

Start with a concise summary ordered by severity. Then list concrete findings with suggested fixes. Do not edit files unless asked.
