# Start with direct sandbox GitHub publication

## Status

Accepted

## Date

2026-09-05

## Context

ADR 0002 kept every GitHub credential outside the sandbox and required a durable Git bundle plus a trusted publisher. That design gives Ornn an enforceable publication boundary, but it adds artifact transfer, validation, import, publishing, and recovery work before the first implementation flow can produce a branch.

GitHub App installation tokens can be limited to one repository, a permission subset, and a short lifetime. They cannot be limited to one branch or ref. Giving a raw `Contents: write` token to a sandbox therefore grants broader repository authority than the intended job-owned branch, subject to repository rules. See [the token-scope research](../research/github-app-token-branch-scope.md).

## Decision

The first Implement Flow will use direct sandbox GitHub publication as its default publication mode. The trusted control plane or Runner will mint a short-lived GitHub App installation token for the Job's repository with `Contents: write` and `Pull requests: write`. It exposes the token only to that Job's sandbox and only after the Job enters its publication phase. The sandbox may then use ordinary `git` and `gh` commands to push its job-owned branch and create or update its draft pull request. It will never receive the operator's personal GitHub credential or GitHub App administration permission. Ornn removes or revokes the token when the Job becomes terminal or is cancelled.

Flow policy still directs the Job to create or update its own branch and draft pull request. It forbids force pushes, ref deletion, and writes to the default or protected branches. These restrictions are policy, not a branch-scoped property of the token. Ornn must not claim that Level 3 technically enforces an exact target ref, and the first version does not require repository rules that enforce the policy.

An authorized Implement Invocation grants publication authority without a second approval step. During one Job, the sandbox has no numeric limit on pushes to its branch or updates to its draft pull request. The Job's overall time and capability limits still apply. This keeps recoverable work on GitHub instead of trapping it on a Runner. The Invocation also authorizes the repository automation normally triggered by those pushes and pull-request updates. Ornn reports detected automation during analysis and asks only when an effect falls outside Flow policy.

If a push succeeds but a later publication operation fails, Ornn preserves the branch, records the partial state, and retries the remaining operation idempotently. It does not delete already published work and restart from scratch.

The stronger publication modes remain planned hardening:

- Level 2 keeps the token in a trusted gateway and exposes only an enforced, job-scoped publication operation. The sandbox may still use a custom Git remote helper so the agent experience resembles `git push`.
- Level 1 exports an immutable change artifact and publishes it through a separate trusted publisher as ADR 0002 described.

## Alternatives

### Start with isolated publication

- **Pros**: Keeps credentials away from untrusted code and enforces the exact published commits and ref.
- **Cons**: Adds several moving parts before Ornn can complete an implementation flow.

### Start with brokered restricted publication

- **Pros**: Enforces the target repository and ref while preserving a Git-like agent experience.
- **Cons**: Requires a trusted gateway or custom Git remote protocol before the first implementation flow.

### Start with direct sandbox publication

- **Pros**: Uses ordinary GitHub App tokens, `git`, and `gh`; it is the shortest route to a working implementation flow.
- **Cons**: The sandbox holds a repository-wide bearer token for the granted permission set. Repository rules, not the token, provide branch protection.

## Consequences

### Positive

- The first Implement Flow avoids bundle export, durable transfer, import, and publisher recovery.
- The same sandbox can analyze, edit, check, commit, push repeatedly, and create or update the draft pull request within one Job.
- Levels 2 and 1 remain compatible with the existing Publication and Capability-grant model.

### Negative

- Prompt injection or untrusted repository code can misuse the token through `git`, `gh api`, or direct HTTP calls during its lifetime.
- `Contents: write` permits more than updating the intended branch, including operations on uncovered refs and other repository content endpoints.
- An agent instruction or wrapper inside the sandbox cannot enforce the branch policy against malicious code.
- Pushes and pull-request updates may trigger repository automation and other configured external effects. The Implement Invocation authorizes ordinary configured effects, so Flow policy must identify effects that still require operator input.
- Ornn needs clear audit events for token issuance, observed publication commands, pushed refs, and token expiry or revocation.

## Related decisions

- [0001](./0001-ornn-owns-the-job-model.md) keeps publication and policy in Ornn's domain model.
- [0002](./0002-publish-commits-through-change-artifacts.md) records the deferred Level 1 design.
- [0005](./0005-keep-the-sandbox-driver-generic.md) keeps GitHub publication outside the sandbox-driver interface.
