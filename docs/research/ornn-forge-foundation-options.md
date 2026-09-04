# Ornn Forge foundation options

## Purpose

This document records the options considered for assembling Ornn Forge and the evidence gathered about them. It is a working research record, not yet a recommendation.

The decision sought is a build-ready direction for a production-grade first slice that handles one real GitHub repository from invocation through an analysis artifact.

## Research reports

- [Foundation and workflow candidates](./foundation-workflow-candidates.md)
- [Agent engines and sandbox runners](./agent-engines-and-sandbox-runners.md)
- [Control-plane portability and telemetry](./control-plane-portability-and-telemetry.md)

## Resolved decisions

- [Select Ornn Forge's assembly level](https://github.com/bjesuiter/ornn-forge/issues/5): Ornn owns the job model and composes focused components behind pinned, tested, application-owned contracts. See [ADR 0001](../adr/0001-ornn-owns-the-job-model.md).
- [Select the first agent engine and sandbox runner](https://github.com/bjesuiter/ornn-forge/issues/6): Start with a Pi-powered Remote Runner on `homeserv1` and local Docker; prove Codex next, then an Embedded Runner with Daytona's managed API.
- [Decide whether a temporary bridge earns its removal cost](https://github.com/bjesuiter/ornn-forge/issues/10): Do not adopt a temporary full-solution bridge. Retain `gh-aw`'s separation of read-only inference from privileged publication as an Ornn-owned security boundary.

## Current synthesis

This is the evidence-backed starting point for the open architecture decisions. It is not final until the corresponding Wayfinder tickets close.

| Area | Current direction | Main reason |
| --- | --- | --- |
| Overall assembly | Decided: Ornn-owned Cloudflare control plane and capability contracts | Full solutions own a competing job or workflow model |
| First Runner | Decided: Remote Runner on `homeserv1` with bounded Runner capacity | It provides an independently operated path and can host one Pi session and one sandbox per job |
| First agent engine | Decided: Pi; Codex follows as the first real replacement | Pi keeps subscription credentials in the trusted Runner while routing tools into the sandbox |
| Sandbox-driver module | Ornn owns a small interface; one pinned TanStack adapter reuses bundled or custom providers internally | TanStack saves provider integration work without defining Ornn's security, cleanup, identity, or error semantics |
| First sandbox driver | TanStack's Docker provider behind the Ornn adapter | It is self-hosted on `homeserv1` and exposes the filesystem and process operations Pi's tools need |
| Next execution path | Embedded Runner in Cloudflare with TanStack's Daytona provider, pending feasibility research | It proves both Embedded Runner execution and a managed remote sandbox without making Daytona authoritative |
| Runner transport | Authenticated outbound HTTPS first; Iroh later for NATed personal machines | Iroh does not run directly in the Cloudflare Workers runtime and solves connectivity rather than job ownership |
| Durable coordination | One recoverable Durable Object per active job | Durable Objects serialize active work, while D1 retains the portable authoritative history |
| Durable records | D1 with Drizzle and an append-only job event timeline | The SQL schema and data have a practical exit to another SQLite implementation |
| Artifacts | R2 behind a small Ornn-owned S3-shaped contract | Artifact data and operations can move to a tested self-hosted S3 implementation |
| Instrumentation | OpenTelemetry, with stable Ornn correlation attributes | It keeps instrumentation independent from storage and inspection tools |
| Telemetry inspection | D1 event timeline, R2 log artifacts, and Cloudflare's trace viewer first | A separate backend adds operational weight and is not needed for the authoritative audit trail |
| Optional telemetry backend | OpenObserve when retained cross-component search becomes necessary | It is a single self-hostable OTLP backend for logs, metrics, and traces |
| Durable workflow framework | Do not adopt Restate initially | It would own job semantics and uses a non-OSI runtime license |
| Temporary bridge | Decided: none | `gh-aw` is too tightly bound to GitHub Actions and too far from Ornn's intended architecture to justify adoption and removal work |

## Current decision criteria

### Hard requirements

- Ornn must not depend on an application component or managed service without a credible exit to an independently operable replacement.
- Ornn must own the overall system shape, including its GitHub contract, job model, deployment, Runner protocol, and sandbox-driver interface.
- Ornn must be assembled from a small set of independently testable, observable capabilities. Higher-order workflows should compose those capabilities rather than hide them inside one framework-controlled operation.
- The system must support Embedded and Remote Runners, with the Remote Runner integrated first.
- Docker, Daytona, and future sandbox platforms must fit behind the same Ornn-owned sandbox-driver interface.
- The agent engine must be replaceable independently from the Runner, sandbox driver, and model provider.
- The first slice must be suitable for daily production use, including credible security, correctness, cleanup, and failure handling.
- Required application components must be self-hostable. Managed infrastructure and model APIs are acceptable when Ornn owns the boundary and a credible replacement exists.
- The initial control plane will run on Cloudflare. Cloudflare-specific services must remain behind application-owned contracts so the control-plane code can move later.
- New Cloudflare services beyond the accepted initial set require an explicit portability decision before adoption.

### Preferences

- Prefer assembling focused components over adopting an opinionated full product.
- Prefer candidates that expose one useful capability behind a narrow interface over candidates that require adopting their complete workflow model.
- Prefer stable dependencies and explicit boundaries over fast-moving frameworks that control the architecture.
- Reach the first real repository flow in days rather than weeks.
- A full solution may be acceptable as a temporary bridge if Ornn can replace it without migrating its core concepts or user-facing contract.
- Any temporary full solution must be time-boxed, store no irreplaceable state, and preserve Ornn's GitHub-facing contract and artifact shapes.
- Runtime cost matters, but vendor independence and maintenance stability matter more.

## Confirmed operating scope

- The first slice stops at a build-ready direction, followed by a real analysis flow against one GitHub repository.
- The control plane should run on Cloudflare initially.
- The only initially authorized GitHub actor is `bjesuiter`.
- The GitHub App may operate on every repository to which it is installed. Repository ownership does not grant invocation authority to other users.
- The initial agent engine is Pi using the user's OpenAI subscription. Codex is the first real replacement proof, and the available OpenAI model variant should be selectable at runtime.
- Ornn will have an operator-controlled default agent profile. The authorized invoker may select another allowlisted profile per invocation. Each job records the resolved engine, model, and context configuration rather than depending only on a mutable profile name.
- Anthropic models are expected later for adversarial code review; that review is not yet part of the first slice.
- The control plane is one modular deployment managed by one operator. Capabilities are internal code boundaries, not microservices.
- Research may add alternatives when they fill a missing capability or provide a clearly stronger self-hostable comparison.
- The first implementation should arrive in days rather than weeks, but speed does not outrank control, security, or stability.
- Production-grade means reliable operation by one operator. It requires a secure authenticated entrance, strict invocation authorization, inspectable job state, and a minimal useful telemetry set. Cloudflare supplies availability for its underlying services, so Ornn does not need its own high-availability system in the first slice.
- The first path uses a Remote Runner on `homeserv1`, one Pi session and one Docker sandbox per job, configurable Runner capacity, and authenticated outbound HTTPS polling.
- The next path is an Embedded Runner in Cloudflare using Daytona's maintained managed service. Its runtime and authentication feasibility remains under research.
- Iroh applies to a later Remote Runner transport. Sandbox platforms remain behind the sandbox-driver interface and may use their native connections inside an adapter.

## Permitted Cloudflare building blocks

These are permitted starting points, not yet selected or verified conclusions.

- Durable Objects may hold durable job coordination if Celld provides a sufficiently compatible self-hosted exit.
- D1 may hold relational state if Drizzle keeps the application model portable to another SQLite host or database.
- R2 may hold artifacts if Ornn uses an S3-compatible storage boundary.
- Any additional Cloudflare service requires a separate portability review with the user.

## Candidate inventory

No candidate below has been evaluated yet. Notes marked as user context record the starting hypothesis, not a research finding.

### Existing solutions

#### OpenClaw

- Evaluation status: complete; retain as an operational and security design reference, not a dependency.
- User context: OpenClaw currently uses itself in its development workflow.
- User context: it is opinionated, changing quickly, and does not currently appear adjustable enough for Ornn's needs.
- Question: could it provide a disposable route to the first slice without owning Ornn's durable concepts?

#### GitHub Agentic Workflows, `gh-aw`

- Evaluation status: complete; leading disposable bridge, not a permanent foundation.
- User context: capabilities and fit are not yet known.
- Question: can it provide useful GitHub-native workflow pieces while preserving self-hosting and control?

### Building blocks

#### Sandcastle

- Source: https://github.com/mattpocock/sandcastle
- Evaluation status: complete; leading focused runner-side component behind Ornn-owned contracts.
- Question: which orchestration, sandbox, and agent-execution responsibilities does it own, and can those parts be adopted independently?

#### TanStack AI sandbox approach

- Source: https://tanstack.com/blog/run-coding-agents-in-a-sandbox
- Evaluation status: complete; reuse pinned `SandboxProvider` implementations inside one Ornn adapter, with Docker first and Daytona next.
- Decision: Ornn retains its own small `SandboxDriver` interface because TanStack does not guarantee Ornn's resource policy, error distinctions, cancellation semantics, or verified cleanup. Custom sandbox targets may implement TanStack's public provider contract and must pass Ornn's contract tests.

#### Flue 2

- Source: https://flueframework.com/blog/flue-2/
- Evaluation status: complete; conditional disposable bridge, not a permanent dependency.
- Question: can its workflow model support durable, inspectable jobs without taking control of Ornn's domain model?

### Lower-level implementation options

#### pi coding agent SDK

- Source: https://pi.dev/
- Evaluation status: complete; leading first agent engine because its tools can be routed into a separate sandbox while credentials remain in the trusted runner.
- Question: how much agent execution behavior does it supply, and what orchestration would Ornn still need to own?

#### Tardigrade

- Source: https://github.com/clavia-labs/tardigrade
- Evaluation status: complete; retain its immutable-event and composable-component model as a design reference.
- Question: which durable execution or agent-runtime responsibilities can it supply as a self-hosted component?

### Level still to classify

#### Restate

- Source: https://docs.restate.dev/
- Evaluation status: complete; reject for the first build because it would own Ornn's job semantics and its runtime license is not OSI-approved.
- Question: is Restate best treated as the durable control plane, one building block inside it, or unnecessary machinery for Ornn's scale?

#### Celld

- Evaluation status: complete; use as a pinned source-compatibility target, not as a production failover or Durable Object data-migration path.
- User context: Celld, by Ryan, is believed to provide a self-hostable implementation compatible with Cloudflare Durable Objects.
- Question: how complete is that compatibility, what migration path does it support, and is it credible enough to make Durable Objects reversible?

#### Iroh

- Evaluation status: complete; retain for a later Ornn-built Runner transport, after the HTTPS-connected first Remote Runner.
- User context: Iroh is the preferred connection layer for an Ornn-built Remote Runner.
- User context: the Cloudflare control plane may connect to a runner through public Iroh relays, with the option to replace those relays later.
- Question: can Iroh provide the authenticated, replaceable connection layer while Ornn retains ownership of runner enrollment, authorization, leasing, and job state?

#### EvLog

- Source: https://www.evlog.dev/
- Evaluation status: set aside before evaluation.
- Reason: OpenTelemetry is the preferred standard for instrumentation and telemetry transport.

#### OpenTelemetry

- Source: https://opentelemetry.io/docs/what-is-opentelemetry/
- Evaluation status: complete; select as the instrumentation standard, while keeping the authoritative job timeline in D1.
- Finding: OpenTelemetry is an open-source, vendor-agnostic framework for generating, collecting, and exporting traces, metrics, and logs. It defines APIs, SDKs, conventions, and the OTLP protocol.
- Finding: OpenTelemetry explicitly does not provide the storage backend or visualization frontend. Ornn must still select where telemetry is retained and how the operator inspects it.
- Question: which OpenTelemetry SDK and export path work reliably in the Cloudflare control plane and Runners, and what self-hostable backend should store the first slice's telemetry?

### Additional alternatives surfaced by research

#### Codex

- Evaluation status: complete; strong second agent engine and fast spike option, but subscription credential placement makes Pi the cleaner first engine.

#### Daytona

- Evaluation status: complete; use the maintained managed API as the next sandbox-driver proof, but not as the self-hosting foundation because the last public self-hosted release is frozen.

#### NVIDIA OpenShell

- Evaluation status: complete; keep as the sandbox security benchmark and possible later sandbox-driver implementation.

#### OpenObserve

- Evaluation status: complete; preferred unified self-hosted OTLP backend when Ornn needs retained telemetry search beyond its D1 and R2 audit records.

#### Jaeger

- Evaluation status: complete; smaller permissively licensed alternative when trace search alone is sufficient.

#### Uptrace

- Evaluation status: complete; reject for the first slice because its ClickHouse and PostgreSQL stack is too heavy for one operator.

## Open comparison questions

- Which responsibilities must Ornn own to preserve a cheap exit from every dependency?
- What is the smallest useful set of Ornn capabilities from which analysis and implementation jobs can be composed?
- What contract makes each capability independently testable without forcing all capabilities into one process or deployment?
- Can a temporary full solution be isolated behind the same contracts intended for the long-term system?
- What isolation mechanism should a user-owned machine provide for untrusted repository work?
- What protocol should connect Remote Runners, including user-owned machines, to the control plane?
- What minimal telemetry makes every job inspectable without requiring a custom dashboard?
- Where should OpenTelemetry data be stored and inspected in the first slice?
- Which candidates are actually self-hostable under licenses and deployment models acceptable for this project?
- Are the proposed exit paths from Durable Objects, D1, R2, and model APIs technically credible rather than merely similar in concept?
- Which composition can plausibly deliver the first production-shaped repository flow within a few days?

## Evaluation log

- 2026-09-04: Evaluated turnkey and workflow-level candidates in [Foundation and workflow candidates](./foundation-workflow-candidates.md).
- 2026-09-04: Evaluated agent engines, Runners, sandbox drivers, and transports in [Agent engines and sandbox runners](./agent-engines-and-sandbox-runners.md).
- 2026-09-04: Evaluated control-plane portability and telemetry exits in [Control-plane portability and telemetry](./control-plane-portability-and-telemetry.md).
- 2026-09-04: Chose an Ornn-owned job model that composes focused components behind replaceable contracts in [Select Ornn Forge's assembly level](https://github.com/bjesuiter/ornn-forge/issues/5).
