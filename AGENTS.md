# Agent instructions

## Agent skills

### Issue tracker

Issues and specs are tracked in this repository's GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

Record each non-binding idea as its own GitHub issue with the `needs-triage` label. Keep it brief: the idea, its expected benefit, and questions to decide later.

### Triage labels

Use the five canonical triage labels without overrides. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses the single-context domain-doc layout. See `docs/agents/domain.md`.

### Test scope

Before proposing a test, identify the nontrivial Ornn-owned behavior it protects or the known regression it covers. Do not propose tests for trivial behavior or behavior owned by a framework or library unless an issue requires it.
