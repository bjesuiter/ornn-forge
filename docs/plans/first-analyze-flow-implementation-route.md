# First Analyze Flow implementation route

## Decision

Build the first production Analyze Flow in eight ordered tracer-bullet slices. Each slice must run through the real interfaces introduced so far and leave the system deployable. Do not create horizontal tickets for every table, transport DTO, or vendor client. Those details belong inside the slice that first needs them.

The first three slices prove the Cloudflare control plane, GitHub interaction, D1 authority, TanStack Workflow, and Remote Runner protocol with a deterministic fixture executor. The next three replace the fixture path with the real `homeserv1` Runner, Docker sandbox, Pi engine, and Analyze Flow. The last two prove interruption behavior and operate the result against one real repository.

No further architecture decision blocks implementation. OpenCode's terms remain a production provider gate, not an implementation blocker. If written confirmation for unattended Zen routing is missing at go-live, switch the existing `FlowRouter` adapter to the tested Workers AI Nemotron fallback. Do not silently change the pinned model.

## Code shape

Convert the repository into a small Bun workspace when the Remote Runner is introduced:

```text
apps/control-plane   TanStack Start on Cloudflare Workers
apps/runner          Node-compatible Remote Runner for homeserv1
packages/domain      Ornn types, state transitions, schemas, and ports
packages/protocol    Versioned control-plane and Runner wire schemas
```

Keep the current application at the repository root until that move pays for itself. Pin every production dependency when it enters a slice. Remove the current `latest` ranges before the first deployment.

The main modules should be deep. Callers should not coordinate database tables, workflow state, or provider retries themselves.

| Module | Small external interface | What it hides |
| --- | --- | --- |
| `InvocationCoordinator` | Admit one raw GitHub delivery or one accepted clarification reply | Signature verification, actor and installation policy, source snapshots, deduplication, routing, clarification state, and Job creation |
| `FlowRouter` | Route one normalized routing context | Prompt construction, schema validation, one validation retry, model selection, usage accounting, and fail-closed behavior |
| `JobCoordinator` | Start, resume, cancel, or accept one lease-scoped observation | TanStack Workflow mechanics, D1 transitions, leases, capability grants, terminal races, effect fences, and projections |
| `MessageOutbox` | Prepare and reconcile one Ornn message publication | Revision history, GitHub create/edit calls, stable effect keys, unknown-effect recovery, and `om_...` links |
| `InspectionReader` | Read one typed Invocation, Job, stream, message, artifact, or object | D1 joins, authorization, pagination, bookmarks, relation expansion, and R2 object checks |
| `RunnerJobExecutor` | Execute one leased Job and emit typed observations | Pi session lifecycle, tool routing, repository preparation, sandbox lifecycle, artifact collection, cancellation, and local recovery |
| `SandboxDriver` | Use the interface fixed by ADR 0005 | Docker identity, native handles, resource policy, effect certainty, discovery, termination, and verified deletion |

Use ports only at real seams. GitHub, Zen or Workers AI, D1 or SQLite, R2 or Garage, TanStack Workflow, the Remote Runner transport, Pi, and Docker each need a production adapter and a fake or conformance adapter. Do not create repository interfaces for each D1 table or expose TanStack, Pi, Docker, or provider types through `packages/domain`.

```text
GitHub -> InvocationCoordinator -> JobCoordinator -> D1
              |          |              |
          FlowRouter  MessageOutbox  InspectionReader
                         |
                  outbound HTTPS lease
                         |
                 RunnerJobExecutor -> Pi
                         |
                   SandboxDriver -> Docker
```

Tests should use the same module interfaces as production callers. Keep focused adapter conformance tests, then delete shallow tests that only repeat internal implementation details.

## Slice 1: admit and inspect one Invocation

### Outcome

A signed GitHub issue-comment delivery from `bjesuiter` creates exactly one Invocation in D1. The authenticated operator can inspect it and its ordered events through JSON endpoints. No Job starts yet.

### Build

- Pin the current TanStack Start and Cloudflare dependencies. Add Drizzle, checked-in D1 migrations, versioned Ornn IDs, canonical JSON hashing, and the first immutable records, event stream, and projections from the audit contract.
- Implement `InvocationCoordinator.admitGitHubDelivery` with raw-body signature verification, installation and repository checks, the single allowed GitHub actor, bounded source snapshots, and delivery idempotency.
- Implement operator bearer authentication and the Invocation and stream reads from `InspectionReader`. Return `Cache-Control: no-store` and versioned JSON.
- Add structured error codes and redacted logging from the start. Invalid signatures create no Invocation and no stored signature value.

### Proof

- A signed fixture and a live GitHub App delivery each create one inspectable Invocation.
- Replaying the delivery returns the original identity. Reusing its delivery ID with another body fails without mutation.
- Unauthorized actors and invalid signatures cannot create work.
- The same contract passes against local SQLite and deployed D1.

## Slice 2: route or clarify through GitHub

### Outcome

An admitted Invocation either selects the enabled Analyze Flow and creates one durable Job, or publishes a clarification Ornn message. An authorized reply resumes the Invocation and can create the Job. Routing consumes no Runner capacity.

### Build

- Add the trusted TypeScript `FlowRegistry`. Enable only Analyze in the first deployment; do not advertise an unimplemented Flow to the router.
- Implement `FlowRouter` with TanStack AI and the paid Zen `gemini-3.5-flash-lite` adapter. Preserve the tested flat schema, postconditions, invocation-scoped session header, zero temperature, output cap, and single validation retry.
- Implement the GitHub adapter and `MessageOutbox` for clarification creation and revision. Every published message ends with its visible `om_...` self-link.
- Add accepted clarification inputs, routing provenance, message revisions and relations, usage and cost records, and message lookup to D1 and `InspectionReader`.
- Infer a reply only when one interaction is pending on the issue. Require its Ornn message ID when several interactions are pending.

### Proof

- Run the fixed 14-case routing corpus against the module's fake adapter on every test run and the paid adapter in an explicit smoke test.
- A hostile issue body cannot select a Flow or authorize an override.
- A selected route creates one Job with its exact Flow version and resolved configuration. A clarification creates no Job, lease, session, or sandbox.
- Retrying a timed-out GitHub publication reconciles the existing comment instead of creating a second user-visible question.

## Slice 3: complete a fixture Job through a Remote Runner

### Outcome

A selected Analyze Job runs through TanStack Workflow and an authenticated outbound-HTTPS Remote Runner. A fixture executor returns a canned structured analysis artifact, Ornn publishes it to GitHub, and the operator can inspect the entire lifecycle.

### Build

- Implement `JobCoordinator` over D1 and a pinned TanStack Workflow adapter. D1 accepts terminal state; TanStack owns timers and execution mechanics only. Add no Durable Object.
- Define the versioned Runner polling, lease, heartbeat, event append, related-message read, cancellation observation, and result schemas in `packages/protocol`.
- Start with one 256-bit Runner bearer credential stored through systemd encrypted credentials. Store only its identifier and digest in D1. Bind every short-lived signed lease grant to Runner, Job, lease, generation, expiry, and allowed operations.
- Build a minimal `apps/runner` process whose fixture executor accepts one lease, heartbeats, emits allowlisted observations, and returns a schema-valid canned artifact.
- Finish the Job, message, artifact, and read-only operator endpoints from the audit contract.

### Proof

- A real GitHub invocation reaches the fixture Remote Runner and returns one final analysis message.
- Duplicate polls, callbacks, workflow retries, and Runner events preserve one Job, one event order, and one publication effect.
- A wrong Runner, stale generation, expired lease, disallowed event, or unrelated `om_...` ID receives no data and appends nothing.
- Losing TanStack's completed workflow record does not make the D1 Job or artifact uninspectable.

## Slice 4: execute inside the recoverable Docker sandbox

### Outcome

The real `homeserv1` Runner leases a Job, creates one network-disabled Docker sandbox, executes a deterministic fixture command, collects its artifact, destroys the sandbox, and releases capacity only after verified absence.

### Build

- Implement the Ornn-owned `SandboxDriver` and Docker adapter from ADR 0005 and the cleanup contract. Keep TanStack sandbox types inside the adapter.
- Add deterministic names, ownership labels, digest-pinned images, resource limits, `restart=no`, `init=true`, no automatic removal, and `network=none`.
- Add the Runner's local recovery ledger, startup discovery, effect certainty, whole-container termination, artifact collection, quarantine, and continuing cleanup reaper.
- Implement capacity reservations independently from execution outcome. A failed or unknown cleanup keeps its slot.
- Prepare the repository at the pinned commit on the trusted Runner with a short-lived read-only GitHub App installation token, then import the credential-free workspace into the sandbox.

### Proof

- Run the sandbox-driver conformance suite against Docker, including every stable error and uncertain mutation.
- Kill the Runner after each create, execute, collect, terminate, and destroy checkpoint. Restarting must adopt or quarantine the exact owned container and never invent cleanup success.
- Prove that the container has no network, Docker socket, host workspace, Runner state, credential directories, or another Job's files.
- A successful execution with failed cleanup remains visible as those two independent facts and keeps capacity occupied.

## Slice 5: run Pi without exposing its credential

### Outcome

The Runner executes one real Pi session against the sandbox checkout. Pi can use only Ornn-provided repository tools. The operator can restore that Runner's model access through a private control-plane page without SSH or credential transfer.

### Build

- Implement the Pi `AgentEngine` adapter with one fresh session per Job. Route read, write, search, and command tools through `SandboxDriver`; disable Pi host tools, shared sessions, default discovery, and repository-provided extensions or MCP configuration.
- Implement the encrypted Runner-local `CredentialStore`, atomic refresh writes, Runner auth health, and zero authenticated capacity on credential or storage failure.
- Add the minimal private reauthentication page and protocol. The control plane may retain one-time instructions only while the attempt is active. Reusable OpenAI credentials never leave the Runner.
- Package the pinned, reviewed blast-radius skill in operator-controlled Runner configuration. Do not let repository content load skills.

### Proof

- Complete device authorization, restart the Runner and host, and run another Pi Job without reauthentication.
- Canary secrets never appear in the control plane, D1, R2, telemetry, GitHub, sandbox mounts, process arguments, or environment.
- Concurrent token refresh produces one durable replacement. Corruption, disk-full, invalid refresh, and lost-key cases advertise zero authenticated capacity rather than falling back to plaintext.
- Pi reads and modifies the sandbox workspace and returns a fixture artifact, but cannot read the Runner host or publish repository changes.

## Slice 6: produce the real Analysis artifact

### Outcome

The enabled Analyze Flow assesses one issue against its pinned repository revision and returns exactly one structured result: focused operator questions, an implementation plan, or a technical blocker. GitHub shows one updated progress message and one final Ornn message backed by D1.

### Build

- Construct the Analyze work order from the accepted Invocation, resolved Flow configuration, repository facts, and artifact schema.
- Add the default anonymous web-research grant through the exact pinned `code-yeongyu/pi-webfetch` commit on the Runner. Keep its accepted personal-v1 private-network risk explicit and keep all sandbox egress disabled.
- Require strategy comparison and the full pinned blast-radius procedure for the recommended strategy. Capture claims, proof status, alternatives, affected code and contracts, risks, and remaining implementation checks.
- Implement soft and hard investigation limits, authoritative duration and usage records, progress-message revisions, and the `questions`, `plan`, and `blocked` artifact variants.
- Pause the same Job, Pi session, sandbox, and capacity reservation for operator questions. Resume it only from an accepted related reply.

### Proof

- One prepared issue ends in a plan with runtime-backed blast-radius evidence.
- One underspecified issue pauses with focused operator questions, then resumes the same Job after the authorized reply.
- One technical unknown triggers the next cheap web or codebase investigation before it can end as `blocked`.
- Selecting another strategy reruns the full blast-radius check. Changing the pinned repository revision prevents stale safety claims from passing silently.
- The final GitHub rendering can be recreated from the D1 artifact and message revision without model output or telemetry.

## Slice 7: survive cancellation, crashes, and provider uncertainty

### Outcome

The complete Analyze Flow remains correct under duplicated delivery, workflow replay, Runner loss, provider timeouts, cancellation, and failed cleanup. Partial evidence remains inspectable.

### Build

- Finish the durable intent and effect reconciliation path for GitHub messages, R2 objects, model calls, and Runner operations.
- Implement authorized cancellation, the capability-use fence, Pi abort, whole-container termination, partial artifact preservation, and independent cleanup retries.
- Add lease expiry and reassignment rules. Never reassign while the prior sandbox or effect state is unknown; reconcile first.
- Store sanitized diagnostic bundles in immutable R2 objects and configure the 30-day lifecycle. Keep metadata, hashes, expiry, and verified deletion state in D1.
- Emit OpenTelemetry logs and traces only after D1 accepts an event. Export failure cannot delay or fail the Job.

### Proof

- Run the audit contract tests, fault injection matrix, cancellation matrix, cleanup recovery tests, projection rebuild, and D1 export/import recovery drill.
- Cancel before execution, during a tool call, while publishing, and after execution but before cleanup. Each case preserves completed effects and forbids new ones.
- Disable telemetry and R2 temporarily. The Job remains correct, and unknown external effects reconcile before retry.
- Restart the control plane and Runner at every durable checkpoint. D1 reconstructs the same Job, message, artifact, execution outcome, and cleanup status.

## Slice 8: operate one production repository

### Outcome

The GitHub App, control plane, D1, R2, and `homeserv1` Runner operate the Analyze Flow for one real repository with documented recovery and bounded spend.

### Build

- Add production migrations, backup and restore instructions, secret rotation, Runner installation and systemd hardening, image preparation, R2 lifecycle configuration, and one-command health checks.
- Configure Zen workspace spending limits and record route usage. Before enabling Zen for unattended production routing, obtain written permission under the current terms. Otherwise select the tested Workers AI adapter and record that provider change in Flow configuration.
- Add readiness checks for GitHub App permissions, D1 migration version, object-store access, Runner transport auth, Docker image digest, Runner credential health, capacity, and cleanup quarantine.
- Keep the operator web work limited to audit reads and Runner reauthentication. Do not build a dashboard, arbitrary query interface, Implement Flow, Git publication, or multi-user administration.

### Proof

- Run the complete path from a real `@ornn-forge` comment to an inspectable final analysis artifact, then repeat after control-plane and Runner restarts.
- Run a cancellation and a forced cleanup failure in the production-shaped environment and recover both without hand-editing D1.
- Verify that the operator can find the Invocation, Job, events, message revisions, artifact, usage, execution outcome, and cleanup status from an `om_...` ID.
- Complete a restore drill and a dependency-exit smoke test against SQLite plus Garage before calling the first slice production-ready.

## Dependency order and safe parallel work

The slices are sequential acceptance gates. Work inside a slice may proceed in parallel after its shared schemas and interfaces land:

- D1 migrations, module-level fakes, and operator read handlers can proceed together in slice 1.
- The Zen adapter and GitHub outbox adapter can proceed together in slice 2.
- Control-plane lease handling and the fixture Runner can proceed together in slice 3 against the frozen protocol schema.
- Docker adapter work and Runner recovery-ledger work can proceed together in slice 4 against the fixed `SandboxDriver` interface.
- Pi adapter work and credential or reauthentication work can proceed together in slice 5 against the fixed `AgentEngine` and reauthentication protocol.
- Artifact rendering, web-research integration, and Analyze work-order evaluation can proceed together in slice 6 after the artifact schema is fixed.

Do not parallelize work that changes the same domain transition, event payload, wire schema, or D1 migration. Freeze those first, then split adapter work.

## Handoff

`/to-spec` should preserve these eight acceptance gates and the module interfaces above. `/to-tickets` may split a slice by adapter or deployment target, but every ticket must name the slice's end-to-end proof and may not declare the slice complete by testing only its own adapter.

The first implementation route ends after slice 8. Implement publication details, stronger Git publication modes, Exa search, authenticated web access, agent parallelism, a general dashboard, multi-user authorization, and an Embedded Runner remain separate work.
