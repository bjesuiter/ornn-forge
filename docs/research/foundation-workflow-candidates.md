# Foundation and workflow candidates for Ornn Forge

Research date: 2026-09-04

## Question

Which responsibilities can OpenClaw, GitHub Agentic Workflows (`gh-aw`), Sandcastle, Flue 2, and Tardigrade credibly supply without taking ownership of Ornn Forge's GitHub contract, durable job model, agent-engine boundary, or sandbox-runner boundary?

This report evaluates the named projects against Ornn's build-ready destination and control-first criteria. It uses project-owned documentation, source, licenses, changelogs, and release records. Repository activity is a point-in-time maintenance signal, not a prediction of future quality.

## Decision

Build an Ornn-owned Cloudflare control plane and adopt, at most, narrowly bounded runner-side components.

- **Use Sandcastle as the leading focused-component candidate inside the first sandbox runner.** Its small agent and sandbox interfaces already cover Codex, Pi, Docker/Podman, Daytona, streaming, cancellation, timeouts, cleanup, and commit collection. Wrap it behind Ornn's contracts; do not expose Sandcastle's provider, branch, session, or result types to the control plane.
- **Do not make OpenClaw, `gh-aw`, Flue, or Tardigrade the permanent foundation.** Each owns a higher-order execution model that would compete with Ornn's job and capability model.
- **Keep `gh-aw` as the cheapest disposable bridge** if a useful GitHub-hosted analysis flow is needed before Ornn's control plane exists. It is not a prototype of Ornn's architecture: it replaces the GitHub App, Cloudflare control plane, and sandbox runner with repository workflows and GitHub Actions.
- **Keep Flue 2 as a second, Cloudflare-shaped bridge candidate, not as a dependency in the first implementation.** It is technically close to the target stack, but adopting and then extracting its conversation/submission model is unlikely to save time on a build measured in days, and its core API was redesigned between beta and 2.0.
- **Use OpenClaw and Tardigrade as design references.** OpenClaw has valuable operational and security patterns. Tardigrade is the closest conceptual match to capability composition over durable facts, but it is too young and supplies a model-driven harness rather than the initial Codex-or-Pi coding-agent execution path.

No additional candidate was added. The named set already spans turnkey product, GitHub-native workflow compiler, runner-side orchestration library, full agent framework, and event-log harness; another broad alternative would not fill a missing level in this comparison.

## Comparison at a glance

| Candidate | What it owns | Replaceable seams | License / independent operation | Recommended role |
| --- | --- | --- | --- | --- |
| OpenClaw | Gateway, sessions, agent loop, channels, plugins, task ledger/flows, automation, sandbox policy, delivery, operator UI | Model/provider plugins, tools, channels, hooks, context engines, Docker/Podman/SSH/OpenShell sandbox backends | MIT; source and Docker self-hosting available | No software dependency; operational and security reference |
| `gh-aw` | Markdown workflow compiler, GitHub Actions job graph, trigger and permission policy, agent container, firewall, safe outputs, run artifacts | Built-in and custom agent engines, MCP/tools, imports, custom jobs, GitHub-hosted or self-hosted Actions runners | MIT; compiler is self-hostable, execution remains GitHub Actions-centric | Optional disposable bridge; security-pattern reference |
| Sandcastle | One-process coding-agent invocation, worktrees/branches, sandbox lifecycle, agent stream parsing, session transfer, commit collection | Small `AgentProvider` and `SandboxProvider` contracts; built-in Codex, Pi, Claude, Docker, Podman, Daytona, Vercel | MIT; Docker and Podman work entirely on owned machines | Focused component inside a sandbox runner |
| Flue 2 | Agent harness, conversation/submission persistence, model loop, tools, skills, channels, sandbox session, build/deploy integration | Model providers, sandbox drivers, Node databases, channels, observers/OpenTelemetry; Node and Cloudflare deployment targets | Apache-2.0; Node deployment is independently operable, Cloudflare target is platform-specific | Conditional disposable bridge; no permanent role yet |
| Tardigrade | Actor/thread model, immutable event log, component state machines, transition scheduler, model calls, tool loop, durable host, HTTP API | Effect layers, model protocols, components, thread store, Bun/Cloudflare/Celld hosts | MIT; Bun host and Celld path are available | Design reference / later prototype, not first-slice dependency |

## The ownership test

Ornn needs to retain four boundaries:

1. An **invocation** is admitted only after Ornn verifies the GitHub webhook, App installation, repository, and actor `bjesuiter`.
2. A **job** is Ornn's durable record of an attempt, independently of any framework's run, conversation, thread, session, or Actions run.
3. An **agent engine** executes a work order independently of where it runs.
4. A **sandbox runner** leases isolated capacity and reports progress and artifacts independently of which agent engine it hosts.

A candidate can be a permanent component only if it fits behind one of those seams. A bridge may temporarily replace multiple layers, but must preserve the visible invocation and artifact shape and hold no irreplaceable state.

## OpenClaw

### Capabilities and ownership

OpenClaw is a complete personal-agent product rather than a coding-job component. Its Gateway owns ingress, sessions, model execution, tools, channels, delivery, state, automation, and operator interfaces. Its automation subsystem includes persistent schedules, a background-task ledger, and durable multi-step Task Flow. Those are useful precedents, but OpenClaw expresses them in its session, task, channel, and Gateway model rather than Ornn's work order and job model ([automation overview](https://docs.openclaw.ai/automation)).

It has serious sandbox breadth. Sandboxing can use local Docker or Podman, any SSH-accessible host, or OpenShell; the policy selects agent-, session-, or shared-scope environments, workspace access, network configuration, and tool escape hatches ([sandboxing](https://docs.openclaw.ai/sandboxing)). This demonstrates that one higher-level execution system can normalize several owned-machine backends, but OpenClaw's sandbox is coupled to Gateway sessions and tool policy, not exposed as an Ornn-style leased runner.

### Extension points and control

OpenClaw's native plugin system is extensive: plugins can register inference providers, CLI backends, tools, channels, hooks, services, HTTP routes, and context engines. The project explicitly describes good plugin contracts as small, typed, capability-specific, core-owned, and reusable across implementations. That design principle maps directly to Ornn's capability preference ([plugin architecture](https://docs.openclaw.ai/plugins/architecture)).

The extension boundary is not a security boundary. Native plugins execute in the Gateway process and have its filesystem, network, and environment authority; a plugin bug can destabilize the Gateway. The same document also says external use of newer capability-specific helpers should treat them as evolving unless marked stable. A custom GitHub App integration would therefore become trusted OpenClaw plugin code tied to a moving Gateway API.

OpenClaw has generic authenticated HTTP hooks and plugin-owned webhook routes, but not Ornn's desired GitHub App admission contract. Generic hook bearer tokens grant ingress rather than authenticated sender identity; a GitHub route would still need custom signature, installation, repository, and actor verification ([Gateway hook contract](https://docs.openclaw.ai/gateway/configuration-reference#hooks), [plugin HTTP routes](https://docs.openclaw.ai/plugins/architecture-internals#gateway-http-routes)).

### Licensing, self-hosting, and production constraints

The repository is MIT-licensed ([license](https://github.com/openclaw/openclaw/blob/main/LICENSE)), publishes container images, and documents source-built Docker operation ([Docker deployment](https://docs.openclaw.ai/install/docker)). It meets the independent-operation license gate.

The production boundary does not match Ornn's deployment. OpenClaw expects a long-running Gateway. Its own multi-tenant guidance says a Gateway is one trusted-operator boundary, Fleet is experimental, remote runtime endpoints are unsupported, and multi-machine identity-governed fleets require a separate control plane ([multi-tenant hosting](https://docs.openclaw.ai/gateway/multi-tenant-hosting)). Ornn would still need its Cloudflare control plane and runner protocol around OpenClaw, leaving two orchestration systems.

### Maintenance signal

The project is active at very high velocity: its release page shows three stable releases between 2026-08-31 and 2026-09-03 plus several betas immediately beforehand ([releases](https://github.com/openclaw/openclaw/releases)). Current docs also record recently removed plugin APIs, such as the legacy `deactivate` alias removed in August 2026 ([plugin hooks](https://docs.openclaw.ai/plugins/hooks)). This is healthy activity for OpenClaw, but a poor stability profile for an embedded foundation that Ornn would need to adapt against.

### Fit

**No production dependency.** OpenClaw is not a permanent foundation because it owns far more than one Ornn capability and cannot run as the intended Cloudflare control plane. It is not an attractive bridge because building a trusted GitHub plugin and operating a separate Gateway does not validate, or materially shorten, Ornn's own first slice. Keep its sandbox policy, capability-registry guidance, task inspection, and security documentation as reference material.

## GitHub Agentic Workflows (`gh-aw`)

### Capabilities and ownership

`gh-aw` compiles Markdown plus YAML frontmatter into locked GitHub Actions workflows. It owns trigger expansion, permissions, engine setup, sandbox/container topology, tool access, network policy, safe-output jobs, artifacts, and workflow-run observability. Built-in engines include Codex, Pi, Claude Code, Gemini, and Copilot ([about](https://github.github.com/gh-aw/about/), [engine reference](https://github.github.com/gh-aw/reference/engines/)).

Its security design is the strongest immediately reusable precedent in this set. The agent job is read-only by default; proposed writes are buffered as artifacts and applied later by separately permissioned safe-output jobs. Optional threat detection evaluates those artifacts in another isolated job before externalization. The agent runs behind a network firewall and API/MCP proxies, while compilation validates the declarative plan ([security architecture](https://github.github.com/gh-aw/introduction/architecture/), [safe outputs](https://github.github.com/gh-aw/reference/safe-outputs/)). Ornn should copy the separation of untrusted inference from privileged publication even if it does not use `gh-aw`.

GitHub event and command handling is mature. Workflows support issue-comment events and slash-command routing, plus repository-role gates and ordinary Actions `if` expressions ([triggers](https://github.github.com/gh-aw/reference/triggers/), [command triggers](https://github.github.com/gh-aw/reference/command-triggers/)). An Ornn-like bridge can gate directly on `github.actor == 'bjesuiter'` and comment content, although `gh-aw`'s built-in role filters are broader than the exact-user rule.

### Extension points and control

The source workflow can select engines, tools, MCP servers, imports, custom setup steps, custom jobs, safe-output jobs, and runner labels. Third-party engine definitions can pin their CLI version and declare installation and invocation behavior ([custom engines](https://github.github.com/gh-aw/reference/third-party-agent/)). Self-hosted Actions runners are supported, including runner groups and custom infrastructure images, but require a Docker daemon; some secure topologies require Docker-in-Docker ([self-hosted runners](https://github.github.com/gh-aw/guides/self-hosted-runners/)).

The top-level ownership is not replaceable. Every job is a GitHub Actions run compiled into every participating repository. GitHub owns event delivery, queueing, runner assignment, workflow state, secret injection, logs, and artifact retention. `gh-aw` does not expose a sandbox-runner contract that Daytona and an Iroh-connected machine can implement. Moving to Ornn later means replacing the execution and durability model, not swapping an adapter.

### Licensing, self-hosting, and production constraints

The compiler and supporting source are MIT-licensed ([license](https://github.com/github/gh-aw/blob/main/LICENSE)). The workload can use user-owned Actions runners, but the scheduler and workflow record remain GitHub-hosted. This is acceptable only as a bridge because GitHub is already Ornn's user interface. It does not satisfy the desired independently controlled execution plane.

The defaults are credible for a production-shaped bridge but not automatic proof of safety. The project warns that authors can weaken defaults by granting direct writes, opening tools or network access, or adding custom jobs. Codex specifically cannot enforce a non-empty per-command Bash allowlist, so its real boundary must be the containing job, network policy, and read-only token rather than Codex's tool config ([Codex limitations](https://github.github.com/gh-aw/engines/codex/), [FAQ](https://github.github.com/gh-aw/reference/faq/)). Self-hosted runners also need lifecycle hardening because untrusted repository work and Docker access land on operator-managed infrastructure.

The built-in audit command downloads run artifacts and logs and reports MCP use, network behavior, cost, and token metrics. It offers an immediately useful inspection model, although it is Actions-run-centric rather than OpenTelemetry-native ([audit reference](https://github.github.com/gh-aw/reference/audit/)).

### Maintenance signal

The project remains pre-1.0 and releases extremely frequently. The release page shows stable `v0.87.10` on 2026-08-31, stable `v0.88.2` on 2026-09-03, and multiple prereleases around them ([releases](https://github.com/github/gh-aw/releases)). Its README records a security vulnerability affecting versions `>=0.83.3,<0.85.4`; earlier documentation also retired a band of releases for a billing bug ([README](https://github.com/github/gh-aw/blob/main/README.md), [security advisory](https://github.com/github/gh-aw/security/advisories/GHSA-8h78-hpm7-29gg)). Pinning compiled actions and budgeting for upgrades are mandatory.

### Fit

**Disposable bridge, only if immediate utility is needed before Ornn exists.** `gh-aw` can produce a secure read-only analysis comment quickly and can use Codex or Pi on an owned runner. The bridge must be visibly separate from Ornn, keep its result only in GitHub, and be deleted repository by repository when Ornn is ready. It should not be called the Ornn first slice because it does not prove GitHub App admission, Cloudflare durability, the sandbox-runner contract, or runner replacement.

## Sandcastle

### Capabilities and ownership

Sandcastle is a TypeScript library for invoking coding-agent CLIs inside an isolated environment. `run()` combines an `AgentProvider`, a `SandboxProvider`, a prompt, a branch strategy, hooks, timeouts, cancellation, logging, and structured result extraction. It manages Git worktrees, synchronizes isolated workspaces, captures commits, and closes the sandbox ([README and API](https://github.com/mattpocock/sandcastle/blob/main/README.md)).

This is narrower than the other candidates. It does not claim webhook admission, a durable job database, distributed runner enrollment or leasing, retries across process death, GitHub publication, or a hosted control plane. Those omissions are exactly why it can sit inside an Ornn-owned sandbox runner rather than compete with Ornn.

### Extension points and control

The `AgentProvider` interface is small: name, environment, optional session storage, command construction, stream parsing, and optional usage parsing. Built-ins cover Codex, Pi, Claude Code, Copilot, Cursor, and OpenCode ([agent-provider source](https://github.com/mattpocock/sandcastle/blob/main/src/AgentProvider.ts)). Ornn can either use a built-in or implement its own adapter without adopting a framework model loop.

The `SandboxProvider` interface has two principal variants. A bind-mount provider receives the host worktree, mounts, and environment; an isolated provider receives environment and returns command, file-transfer, and close operations. The library exports factories for custom providers and built-ins for Docker, Podman, Daytona, and Vercel ([sandbox-provider source](https://github.com/mattpocock/sandcastle/blob/main/src/SandboxProvider.ts), [Daytona adapter](https://github.com/mattpocock/sandcastle/blob/main/src/sandboxes/daytona.ts)).

That provider interface is useful inside a runner but too small to become Ornn's sandbox-runner contract. It has no runner identity, enrollment, capacity advertisement, lease/heartbeat, durable operation id, reconnection, artifact manifest, or control-plane progress protocol. Ornn should own those concerns and let the runner call Sandcastle after it has claimed a job.

Sandcastle also couples agent invocation and sandbox execution in `run()`, while Ornn wants independently replaceable agent-engine and sandbox-runner boundaries. Preserve that separation in Ornn: the runner-side implementation may compose them with Sandcastle, but Ornn's domain must record the selected engine and runner independently.

### Licensing, self-hosting, and production constraints

Sandcastle is MIT-licensed ([license](https://github.com/mattpocock/sandcastle/blob/main/LICENSE)). Docker and rootless Podman provide a fully owned execution path; Daytona and Vercel are optional adapters. It therefore passes the license and self-hosting gate.

Its cleanup, abort, timeout, and dirty-worktree preservation behavior are explicit and well tested, but they remain in-process lifecycle guarantees. If the runner process or machine dies, Ornn must detect the expired lease and reconcile the sandbox. Sandcastle cannot supply the durable job guarantee.

Credential handling needs an Ornn policy above it. Agent and sandbox providers accept environment variables and mounts, and Codex can use its native session files. The Codex adapter intentionally disables Codex's own sandbox and approval layer because Sandcastle treats the outer sandbox as the security boundary ([Codex adapter](https://github.com/mattpocock/sandcastle/blob/main/src/AgentProvider.ts#L750-L824)). Ornn must inject the minimum credential into the isolated environment, prevent repository code from reading control-plane or GitHub App secrets, and avoid bind-mounting broad host credential directories.

### Maintenance signal

Sandcastle is pre-1.0. GitHub reports the repository was created in March 2026, and the current release is `v0.12.0` from 2026-06-29 ([repository metadata](https://api.github.com/repos/mattpocock/sandcastle), [releases](https://github.com/mattpocock/sandcastle/releases)). Its changelog contains multiple explicit breaking API changes before 1.0, including hook restructuring, worktree terminology changes, and sandbox-provider method changes ([changelog](https://github.com/mattpocock/sandcastle/blob/main/CHANGELOG.md)). Pin an exact version and keep the wrapper narrow.

### Fit

**Focused runner-side component and the best implementation starting point in this set.** It can make the first runner materially faster without owning Ornn's invocation, job, artifact, or deployment model. The first integration should prove only this adapter:

```text
Ornn job lease
  -> runner prepares exact-revision checkout and scoped credentials
  -> Sandcastle composes selected AgentProvider + local sandbox provider
  -> runner translates stream events and result into Ornn progress/artifacts
  -> runner closes sandbox and reports cleanup outcome
```

The wrapper is the removal path: replacing Sandcastle changes runner internals, not the control plane or GitHub behavior.

## Flue 2

### Capabilities and ownership

Flue is a TypeScript agent framework. An agent function composes model, sandbox, skills, tools, subagents, persistent state, lifecycle hooks, and instructions. The runtime also provides durable submissions, conversation streams, channels, routing, database adapters, an SDK, observability, and Node/Cloudflare deployment integration ([project README](https://github.com/withastro/flue/blob/main/README.md), [why Flue](https://flueframework.com/docs/guide/why-flue/)).

On Cloudflare, Flue generates one SQLite-backed Durable Object class per agent identity. Accepted inputs enter that object's submission queue, and one Durable Object invocation runs the complete response. It conservatively reconciles interruptions and avoids blind replay when it cannot prove provider work is safe to repeat. The canonical state is an append-only conversation stream; settled submission rows are retained indefinitely ([Cloudflare deployment](https://flueframework.com/docs/ecosystem/deploy/cloudflare/), [durability](https://flueframework.com/docs/guide/durability/)).

This is close to Ornn's preferred platform but owns the wrong durable aggregate. Ornn's primary record is a bounded job with capabilities, selected agent profile, sandbox lease, progress, artifacts, retries, cancellation, and cleanup. Flue's primary record is an agent conversation plus submissions and turns. Mapping jobs onto conversations would let Flue's persistence format and recovery semantics leak into Ornn's core.

Flue's own Cloudflare documentation says step-level durable continuation requires Cloudflare Workflows. Using that service would add a Cloudflare dependency not yet approved, while still leaving Ornn to model sandbox lifecycle and artifact publication ([Cloudflare interruption semantics](https://flueframework.com/docs/ecosystem/deploy/cloudflare/#interruption-and-recovery-semantics)).

### Extension points and control

Flue has broad provider seams. Models are provider-selectable; `SandboxFactory` and `SandboxDriver` adapt local, virtual, and remote environments; ecosystem blueprints cover Daytona, E2B, Modal, Vercel, and Cloudflare Sandbox; Node deployments can choose database adapters; channels include GitHub; observers and instrumentation can export OpenTelemetry ([sandbox API](https://flueframework.com/docs/reference/sandbox-api/), [ecosystem](https://flueframework.com/docs/ecosystem/), [events](https://flueframework.com/docs/reference/events/)).

Application routing remains controllable. A plain Hono route can verify a webhook before dispatching accepted work to a non-public agent, so an Ornn bridge could own GitHub signature and actor checks at ingress ([routing](https://flueframework.com/docs/guide/routing/#dispatch-only-agents)).

The apparently narrow pieces are not independently packaged enough for Ornn's current plan. Sandbox abstractions and OpenTelemetry instrumentation belong to `@flue/runtime`; the Cloudflare target also depends on generated Flue Durable Objects and Cloudflare's Agents SDK. Using only those interfaces still introduces the framework's runtime and upgrade cycle.

### Licensing, self-hosting, and production constraints

Flue is Apache-2.0 licensed ([license](https://github.com/withastro/flue/blob/main/LICENSE)). It supports independently operated Node deployments and database adapters; its Cloudflare path is deliberately platform-native. On Cloudflare, `db.ts` adapters do not apply: conversation state lives in Durable Object SQLite, and the generated schema carries a Flue format version. The runtime refuses an unknown/newer persisted format, and there is no in-place format migration; incompatible state must be cleared or its class retired ([Cloudflare persistence boundary](https://flueframework.com/docs/ecosystem/deploy/cloudflare/#persisted-format-boundary)). That is a concrete lock-in risk for durable Ornn state.

Flue has an OpenTelemetry adapter and a rich event interface, but telemetry follows agent instance and submission identity. Ornn would still need job-level telemetry and audit records around GitHub admission, runner leasing, artifact publication, and cleanup.

### Maintenance signal

Flue 2 is new and recently underwent a core redesign. The official migration guide says 2.0 replaced its CLI with Vite, replaced config-bag agents with hook-composed functions, removed workflows/runs entirely, renamed dispatch identity, and replaced parts of observability ([2.0 migration guide](https://flueframework.com/docs/guide/migration/)). Tags `v2.0.0` through `v2.0.3` were cut between 2026-07-31 and 2026-08-05, after `v1.0.0-beta.9` on 2026-06-30 ([tags](https://github.com/withastro/flue/tags), [changelog](https://github.com/withastro/flue/blob/main/CHANGELOG.md)). This is too much architectural churn for a stability-first permanent foundation today.

### Fit

**Conditional disposable bridge, not a permanent foundation or focused component.** Flue could produce a Cloudflare-hosted, authenticated GitHub-to-agent-to-comment demonstration quickly, with Durable Objects, Daytona, and OpenTelemetry. The deletion plan would require one conversation per Ornn job, no authoritative state outside GitHub, an application-owned webhook route, an application-owned final artifact publisher, and a hard ban on Flue types in those boundaries.

Do not take that bridge by default. The intended Ornn first slice is only a few days of focused work, and Flue's adoption plus later extraction would consume much of the same effort while proving Flue's model instead of Ornn's. Reconsider only if the custom control-plane estimate grows into weeks.

## Tardigrade

### Capabilities and ownership

Tardigrade is a TypeScript agent-harness framework built around an immutable event log. An actor has methods and composed components. Each component projects state from events and declares enabled transitions; the host executes unrecorded transition keys and appends their outcomes. Replaying the log reconstructs behavior after a process restart ([concepts](https://github.com/clavia-labs/tardigrade/blob/main/docs/getting-started/concepts.mdx), [why Tardigrade](https://github.com/clavia-labs/tardigrade/blob/main/docs/start-here/Why.mdx)).

This is the closest conceptual analogue to Ornn's desired “small capabilities compose a higher-order system” approach. It gives inference, tools, budgets, compaction, permissions, subagents, structured output, and code mode separate components. Durable method call ids absorb duplicate calls, while external effects execute at least once and can receive the transition key as an idempotency key ([README](https://github.com/clavia-labs/tardigrade/blob/main/README.md#how-durability-works)).

Its durable ownership is still broader than one Ornn component. Adopting it means expressing jobs as actors and threads, durable facts as Tardigrade events, capabilities as component machines, and execution as transitions. Tardigrade, rather than Ornn, would own the job state model and recovery algorithm.

### Extension points and control

Tardigrade is designed for extension through Effect services and layers. It separates model policy from wire protocols, allows component-defined behavior, exposes a thread event-store contract, and has Bun, Cloudflare, and Celld hosts. Cloudflare stores each actor thread in a SQLite Durable Object and resumes unfinished work through alarms ([Cloudflare platform](https://github.com/clavia-labs/tardigrade/blob/main/docs/platforms/cloudflare.mdx)). Celld runs the same actor definition and HTTP routes on a self-hosted Worker/Durable Object implementation backed by S3-compatible storage ([Celld platform](https://github.com/clavia-labs/tardigrade/blob/main/docs/platforms/celld.mdx)).

These paths strongly support Ornn's belief that Durable Objects can have a credible exit. They do not establish Tardigrade as the right engine. Its documented runtime makes direct model-provider calls with an API key and its own agent loop; it does not host Codex or Pi as replaceable coding-agent CLIs using the user's existing subscription. Its built-in code mode is a tool/package sandbox, not the required full repository sandbox-runner lifecycle.

### Licensing, self-hosting, and production constraints

Tardigrade is MIT-licensed ([license](https://github.com/clavia-labs/tardigrade/blob/main/LICENSE)). The Bun SQLite host and Celld deployment path support independent operation. The platform interface requires Bun 1.4 or newer for local hosting and is tightly built on Effect TS. Both become foundational dependencies if its event model is adopted ([quickstart](https://github.com/clavia-labs/tardigrade/blob/main/docs/getting-started/quickstart.mdx), [package manifest](https://github.com/clavia-labs/tardigrade/blob/main/package.json)).

The event-log model improves inspection and replay, but at-least-once effects do not by themselves make GitHub comments, sandbox creation, or cleanup exactly once. Ornn would still need idempotent capability contracts and reconciliation against external systems. Tardigrade also does not supply the target GitHub App channel or an owned-machine full Linux runner.

### Maintenance signal

The project is exceptionally young. GitHub reports repository creation on 2026-08-13; it reached `v0.20.0` by 2026-09-03 and published 31 releases in that interval ([repository metadata](https://api.github.com/repos/clavia-labs/tardigrade), [releases](https://github.com/clavia-labs/tardigrade/releases)). That rate is evidence of active development, but it is incompatible with Ornn's stability requirement until the contracts settle and real deployments age.

### Fit

**Design reference and possible later prototype, not a first-slice dependency.** Tardigrade validates the value of immutable facts, replayable projections, keyed effects, and composable behavior. Ornn should borrow those ideas at the job-event level without adopting Tardigrade's entire actor runtime. Re-evaluate it later if Ornn wants a custom direct-model agent engine; it is not the current Codex/Pi engine path.

## Bridge comparison

If the user wants useful analysis before Ornn exists, `gh-aw` is the better disposable bridge:

- It reaches a secure GitHub comment flow with the least application code.
- Its run, logs, and final comment can be discarded without migrating durable application state.
- It can enforce the exact actor with an Actions expression and keep writes in a safe-output job.
- The removal boundary is obvious: delete the compiled workflow and enable the GitHub App.

Flue is closer to the intended Cloudflare deployment, but that resemblance is also the trap: it encourages Ornn's durable state and agent logic to grow around Flue's generated Durable Objects. Use Flue only if Ornn's own control-plane build ceases to fit the days-not-weeks constraint.

Neither bridge should delay the real first slice, and neither should receive the `@ornn-forge` production identity unless it preserves the final invocation syntax and makes its temporary status operationally explicit.

## What Ornn should borrow without adopting

- From OpenClaw: explicit capability ownership, sandbox explanation/inspection commands, trusted-plugin warnings, and separate policy for tools, workspace, and network.
- From `gh-aw`: read-only inference followed by a separately permissioned artifact publisher; compile-time policy checks; default-deny egress; and run audit bundles.
- From Sandcastle: minimal command/stream agent adapters, minimal exec/file/close sandbox adapters, deterministic cleanup, and provider-independent result translation.
- From Flue: application-owned admission before durable dispatch, conservative recovery when effect outcome is uncertain, and OpenTelemetry instrumentation around model/tool operations.
- From Tardigrade: immutable job events, projections for current state, durable idempotency keys for every capability attempt, and explicit at-least-once external-effect semantics.

## Consequences for the first implementation plan

1. Define Ornn's job events and capability contracts before selecting a framework-owned run model.
2. Implement GitHub admission and durable job creation in the Cloudflare control plane with no dependency on the candidates above.
3. Define the sandbox-runner protocol around enrollment, capacity, leases, heartbeat/reconnection, progress, artifacts, cancellation, and cleanup. Do not reuse Sandcastle's in-process provider type as this protocol.
4. Implement one runner that translates the leased job into a pinned Sandcastle invocation with either Codex or Pi and one local or Daytona sandbox adapter.
5. Publish the analysis comment from a separately permissioned control-plane capability after validating and sanitizing the artifact.
6. Record OpenTelemetry spans and append durable job events at every boundary; the candidate frameworks' own run/session telemetry is supplemental.
7. Pin Sandcastle exactly and keep a contract test that can be rerun against an Ornn-native runner implementation. This is the practical exit path.

## Remaining questions for other Wayfinder tickets

- Whether Codex or Pi can use the user's subscription securely inside an ephemeral sandbox without exposing a reusable credential.
- Which first sandbox runner, owned-machine Docker/Podman, Daytona, or another self-hostable runtime, best satisfies the isolation and days-not-weeks constraints.
- Whether Sandcastle's current adapters pass the exact security, cancellation, cleanup, and telemetry tests Ornn requires, or should be copied/reimplemented behind the same Ornn contract.
- The exact durable job-event schema and retry/reconciliation rules.
- The OpenTelemetry backend and operator inspection path.
