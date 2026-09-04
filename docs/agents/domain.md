# Domain docs

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- `CONTEXT-MAP.md` at the repository root, if it exists. It points to context-specific `CONTEXT.md` files.
- Relevant ADRs under `docs/adr/`.
- In a multi-context repository, relevant ADRs under `src/<context>/docs/adr/`.

If a file does not exist, proceed silently. Do not suggest creating it upfront. The domain-modeling flow creates domain files when it resolves terms or decisions.

## File structure

This repository uses the single-context layout:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

Use terms as defined in `CONTEXT.md` in issue titles, proposals, hypotheses, and test names. Do not replace established terms with synonyms.

If a needed concept is missing, reconsider whether the project uses it. If the gap is real, record it for domain modeling.

## Flag ADR conflicts

Call out any proposed change that contradicts an existing ADR. Name the ADR and explain why the decision may need reopening.
