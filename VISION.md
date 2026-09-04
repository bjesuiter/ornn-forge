# Ornn Forge Vision

## Purpose

Ornn Forge turns a work order on GitHub into a verified artifact.

It is a focused agent orchestrator, not a general assistant. A user invokes Ornn from an issue or pull request, adds a custom prompt, and receives an analysis, code change, or draft pull request produced inside an isolated sandbox.

## The Workflow

1. Capture an idea in a GitHub issue.
2. Refine the issue into an executable work order, optionally with OpenClaw workflows such as Wayfinder or `grill-with-docs`.
3. Invoke Ornn with a custom prompt, for example:

   ```text
   @ornn-forge analyze whether this design fits the current architecture.
   ```

   ```text
   @ornn-forge implement this issue, run the relevant checks, and open a draft PR.
   ```

4. Ornn verifies the request, creates an isolated sandbox, checks out the repository at a pinned revision, and executes the prompt.
5. Ornn reports progress and returns a durable artifact to GitHub.

GitHub is the initial user interface, authorization surface, audit trail, and result history. Mention-based activation avoids a separate tracked-repository configuration: the GitHub App installation defines which repositories Ornn can access, while the mention defines when it should act.

## Architecture Direction

- **GitHub App:** receives signed webhook events and acts with narrowly scoped installation permissions.
- **Cloudflare control plane:** authenticates requests, manages durable job state, retries, cancellation, and result delivery.
- **Runners:** execute jobs by combining a selected agent engine with a sandbox driver. The control plane may contain an Embedded Runner, while independently deployed Remote Runners receive job leases.
- **Agent engines:** execute work orders without owning repository access, job state, or artifact publication. Pi is first and Codex is the first replacement proof.
- **Sandbox drivers:** create and control isolated environments behind an Ornn-owned interface. Docker is first and Daytona's managed service is the first remote replacement proof.
- **TanStack AI sandbox providers:** supply internal sandbox implementations through one pinned adapter. TanStack types remain inside that adapter.

Cloudflare is the control plane and may host an Embedded Runner, but it is not necessarily the sandbox plane. The first flow uses a Remote Runner on `homeserv1`; a later Embedded Runner may operate Daytona sandboxes without depending on that machine.

Ornn-owned concepts such as jobs, work orders, permissions, progress, artifacts, Runners, and sandboxes remain independent from TanStack and concrete sandbox platforms. Ornn owns a small `SandboxDriver` interface that adds its security, cancellation, error, provenance, and verified-cleanup guarantees. One internal TanStack adapter reuses bundled or custom `SandboxProvider` implementations behind that interface.

## What Belongs in the Vision

### Prompt execution

Ornn accepts a custom work order rather than exposing only one hard-coded workflow.

Examples:

- Analyze an issue against the current codebase and comment with findings.
- Investigate a bug without changing the repository.
- Implement an approved issue on a new branch.
- Run tests and checks relevant to the change.
- Push the branch and open a draft pull request.
- Collect logs, patches, and other useful artifacts from the run.

### Safe GitHub-native operation

- Trigger work through an explicit invocation such as `@ornn-forge`.
- Verify the webhook signature, installation, repository, and invoking actor.
- Treat issue text, comments, and repository contents as untrusted input.
- Pin repository checkout to an exact revision.
- Default analysis jobs to read-only access.
- Restrict implementation jobs to branches and draft pull requests.
- Never write directly to a protected or default branch.
- Use short-lived, narrowly scoped credentials.

### Reliable isolated jobs

- Create a fresh agent session and sandbox for each job.
- A shared Runner must keep each job's tools, session state, and sandbox lease scoped to that job. One job cannot enumerate or read another job's state.
- Stream or persist progress so a run can be observed.
- Support cancellation, timeouts, retries, and deterministic cleanup.
- Keep durable job state outside the sandbox.
- Handle duplicate webhook delivery without creating duplicate work.
- Preserve useful results even when execution fails.

### Sandbox-driver portability

- Select a sandbox driver without changing GitHub-facing behavior or the agent engine.
- Keep provider-specific setup, networking, secret injection, snapshots, identifiers, and cleanup inside the sandbox-driver module.
- Reuse TanStack providers only after they pass Ornn's sandbox-driver contract tests.
- Permit additional TanStack-compatible providers and direct Ornn adapters without changing callers.

## What Explicitly Does Not Belong Yet

### A general-purpose OpenClaw agent

Ornn does not initially need personal memory, broad messaging integrations, an assistant personality, proactive life management, or open-ended conversations. Igris can refine and coordinate work; Ornn executes bounded work orders.

### A new project-management interface

No custom dashboard, backlog, issue tracker, or mandatory repository registry for the MVP. GitHub already supplies the work surface and history.

### Autonomous unrequested work

Ornn must not continuously watch repositories and decide by itself what to change. It acts only after an authorized, explicit invocation.

### Direct production authority

Ornn must not merge pull requests, push to protected branches, deploy to production, rotate secrets, modify billing, or perform other high-impact external actions merely because repository text asks it to.

### Sandbox-platform lock-in

The core must not depend directly on TanStack types or one sandbox vendor's job model, filesystem interface, lifecycle, or persistence semantics.

### Premature workflow taxonomy

`analyze` and `implement` are useful initial intents, not a closed universe of task types. The durable abstraction is still: execute an authorized prompt and return a verified artifact.

### Multi-job collaboration

Status: idea only. Do not implement in the current scope.

A future Job group may let isolated jobs exchange explicit, durable messages and artifacts while working on one work order. Jobs must not gain access to each other's Pi sessions, host memory, or writable sandboxes. Runner co-location may improve efficiency but must not be required for collaboration.

### Marketplace-scale product features

Multi-tenant billing, public onboarding, broad marketplace distribution, enterprise administration, and a polished standalone UI are outside the current vision. Ornn Forge starts as a focused tool for JB's repositories.

## First Vertical Slice

The first complete slice is deliberately read-only:

```text
GitHub issue comment with @ornn-forge analyze <prompt>
  → verified webhook
  → durable job
  → isolated sandbox
  → repository checkout at a pinned revision
  → read-only analysis
  → result comment on the issue
  → deterministic cleanup
```

Only after authorization, idempotency, observability, and cleanup are proven should Ornn add the implementation slice:

```text
@ornn-forge implement <prompt>
  → branch
  → code changes
  → checks
  → commit and push
  → draft pull request
```

## Identity

**Ornn Forge** is the forge operator: it receives a precise work order and returns something inspectable and durable.

Igris helps shape and command the work. Ornn forges the artifact.
