---
tags:
  - rule
  - workflow
severity: important
applies-to:
  - git commits
  - pull requests (including /open-pr)
created: 2026-06-15
---
# Never add an AI as commit co-author

Commits must never carry a `Co-Authored-By` trailer attributing the work to Claude or any other AI, and the commit `author`/`committer` is always the human — never an AI identity. The human is the sole author of every commit.

## Why

The owner wants sole authorship of the repository's history. An AI `Co-Authored-By` trailer (e.g. `Co-Authored-By: Claude … <noreply@anthropic.com>`) makes GitHub list the AI as a repository **Contributor**, which is unwanted. This already had to be undone once — an amended commit plus a force-push — so prevent it at the source.

## How to Apply

- Do **not** append any `Co-Authored-By:` line for Claude/AI to commit messages — not on direct commits, not via `/open-pr`, not anywhere.
- Never set the commit `author` or `committer` to an AI identity; keep the configured human git user.
- If a default commit or PR template would add such a trailer, strip it before committing.
- Applies to every commit in this repo, no exceptions.
