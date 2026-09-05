# Ornn Forge foundation options

## Purpose

This document records the options considered for assembling Ornn Forge and the evidence gathered about them. It is a working research record, not yet a recommendation.

The decision sought is a build-ready direction for a production-grade first slice that handles one real GitHub repository from invocation through an analysis artifact.

## Research reports

- [Foundation and workflow candidates](./foundation-workflow-candidates.md)
- [Agent engines and sandbox runners](./agent-engines-and-sandbox-runners.md)
- [Control-plane portability and telemetry](./control-plane-portability-and-telemetry.md)
- [Embedded Runner with Pi and Daytona on Cloudflare](./embedded-runner-pi-daytona-cloudflare.md)
- [GitHub App token scope and branch restrictions](./github-app-token-branch-scope.md)

## Resolved decisions

- [Select Ornn Forge's assembly level](https://github.com/bjesuiter/ornn-forge/issues/5): Ornn owns the job model and composes focused components behind pinned, tested, application-owned contracts. See [ADR 0001](../adr/0001-ornn-owns-the-job-model.md).
- [Select the first agent engine and sandbox runner](https://github.com/bjesuiter/ornn-forge/issues/6): Start with a Pi-powered Remote Runner on `homeserv1` and local Docker; prove Codex next, then an Embedded Runner with Daytona's managed API.
- [Validate an Embedded Runner with Pi and Daytona on Cloudflare](https://github.com/bjesuiter/ornn-forge/issues/14): Do not approve the Embedded Runner as specified. The lower-level Pi core and Daytona provider run in a Worker probe, but personal ChatGPT subscription automation, Pi's Worker OAuth path, bounded background duration, and Daytona cancellation and verified deletion do not meet the production contract.
- [Decide whether a temporary bridge earns its removal cost](https://github.com/bjesuiter/ornn-forge/issues/10): Do not adopt a temporary full-solution bridge. Keep publication as an explicitly authorized Ornn effect; ADR 0006 later chose a direct initial provider that does not isolate the GitHub credential from the sandbox.

## Current synthesis

This is the evidence-backed starting point for the open architecture decisions. It is not final until the corresponding Wayfinder tickets close.

| Area | Current direction | Main reason |
| --- | --- | --- |
| Overall assembly | Decided: Ornn-owned Cloudflare control plane and application contracts | Full solutions own a competing job or workflow model |
| First Runner | Decided: Remote Runner on `homeserv1` with bounded Runner capacity | It provides an independently operated path and can host one Pi session and one sandbox per job |
| First agent engine | Decided: Pi; Codex follows as the first real replacement | Pi keeps a separately authorized subscription credential in each trusted Runner while routing tools into the sandbox; the control plane relays only reauthentication instructions and status |
| Sandbox-driver module | Ornn owns a small interface; one pinned TanStack adapter reuses bundled or custom providers internally | TanStack saves provider integration work without defining Ornn's security, cleanup, identity, or error semantics |
| First sandbox driver | TanStack's Docker provider behind the Ornn adapter | It is self-hosted on `homeserv1` and exposes the filesystem and process operations Pi's tools need |
| Next execution path | Keep the Embedded Runner with Daytona as a conditional later proof, not an approved production path | A Worker probe runs the lower-level packages, but supported automation credentials, bounded execution, process cancellation, and verified deletion remain unmet gates |
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
- Ornn must expose independently testable and observable application contracts. Its orchestration must remain visible rather than hiding the job lifecycle inside one framework-controlled operation.
- The system must support Embedded and Remote Runners, with the Remote Runner integrated first.
- Docker, Daytona, and future sandbox platforms must fit behind the same Ornn-owned sandbox-driver interface.
- The agent engine must be replaceable independently from the Runner, sandbox driver, and model provider.
- The first slice must be suitable for daily production use, including credible security, correctness, cleanup, and failure handling.
- Required application components must be self-hostable. Managed infrastructure and model APIs are acceptable when Ornn owns the boundary and a credible replacement exists.
- The initial control plane will run on Cloudflare. Cloudflare-specific services must remain behind application-owned contracts so the control-plane code can move later.
- New Cloudflare services beyond the accepted initial set require an explicit portability decision before adoption.

### Preferences

- Prefer assembling focused components over adopting an opinionated full product.
- Prefer candidates that expose useful mechanics behind a narrow interface over candidates that require adopting their complete workflow model.
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
- The control plane hosts the Runner reauthentication experience but never receives a reusable OpenAI credential. Each Runner independently starts device authorization, exposes only the verification URL, one-time code, expiry, and status through the control plane, and stores and refreshes its own credential. Credentials are not copied between Runners.
- The web research capability will reuse pinned Runner-hosted agent tools and, later, a reviewed Pi MCP adapter rather than an Ornn-built search implementation. Only operator-approved Runner configuration may expose MCP servers; repository-provided MCP configuration is ignored.
- The first web research implementation exposes only anonymous `web_fetch` through a pinned and reviewed Pi extension. It must pass contract tests for private-address blocking, DNS rebinding, redirects, response limits, timeouts, and cancellation. Exa search and MCP integration follow later.
- An authorized invocation is routed to a registered flow by a model, not by fixed command keywords. The router receives the flow catalog, issue title and body, invoking comment, and authorized clarification replies. It must return either a selected registered flow with requested overrides or a concrete clarification question; numeric confidence does not authorize execution.
- The first control-plane flow router uses TanStack AI with OpenCode Go behind an Ornn-owned provider interface. The Go API key stays in a Worker secret, Zen balance fallback remains disabled, and production use requires confirmation that unattended internal routing complies with OpenCode's hosted-service terms. A contract benchmark will compare `glm-5.3-flash`, `mimo-v2.5`, and `deepseek-v4-flash` before pinning the initial model. See [the routing-provider research](./opencode-zen-go-tanstack-ai-routing.md).
- A clarification question includes a visible short invocation reference. A reply from the authorized invoker resumes the sole pending interaction without another mention or explicit reference. When several interactions are pending on one issue, the reply must include the reference. A later dashboard should host these interactions when comment traffic becomes unwieldy.
- Every GitHub comment published by Ornn is an Ornn message with a compact self-link whose visible text is its opaque Ornn message ID, such as `om_01K...`. D1 maps the ID to structured message content and related Invocations, Jobs, interactions, and artifacts. Workflow state may reference the ID, but D1 remains authoritative. The public ID grants no authority. An authorized Invocation may use it as an anchor for resolving related objects. The control plane queries deterministic candidates before model interpretation and asks when the relation remains ambiguous. In the first slice, only the control plane acting for an authenticated operator Invocation or UI session, and a Runner within its current Job lease, may resolve the structured record.
- A Job starts only after Flow routing succeeds and allowed overrides are resolved. Routing clarification does not consume Runner capacity or create an agent session or sandbox.
- Flows are trusted TypeScript modules. They provide default agent configuration, capability grants, providers, artifact handling, and publication policy so the operator configures only deployment-specific or exceptional values. TanStack Workflow is the preferred implementation for durable flow execution behind Ornn-owned job and policy contracts.
- Analyze and Implement are separate registered Flows. The first Analyze Flow evaluates how prepared an issue is for implementation, isolates decisions only the operator can make, and finds or generates viable implementation strategies. It may choose the recommended strategy when repository evidence makes the choice clear. Its artifact contains focused operator questions, an implementation plan, or a technical blocker after permitted cheap investigations are exhausted.
- Blast-radius analysis will compare every viable strategy, then use a pinned, operator-reviewed copy of pstack's MIT-licensed `blast-radius` skill in full for the recommended strategy, initially pinned to `e46364b8be46000b7df0f260550cd712afbb8d36`. It must look past direct callers, state the facts the strategy's safety depends on, prove cheap facts against the real code, and mark the rest unproven. If the operator selects another strategy, Ornn runs the full check for it on demand.
- An Analyze Job may change its sandbox checkout, write proof scripts and tests, create local commits, and run prototypes. It cannot publish those repository changes. When it needs an operator decision, it pauses with its Pi session, sandbox, and Runner capacity reservation intact, then resumes after an authorized reply. Idle-resource optimization follows later.
- An authorized Implement Invocation may consume a prior analysis artifact. Ornn infers it when exactly one eligible plan exists and requires a reference when several could apply. The Implement Job compares the artifact's pinned revision with its own revision and revalidates the plan, safety claims, and blast radius against relevant intervening changes before editing.
- Analysis artifacts are stored as structured D1 records and rendered as human-readable Ornn messages on GitHub. Their Ornn message IDs let later agents and operator tools locate the durable representation without parsing the comment.
- Analyze and Implement Flows grant anonymous web fetch by default. Authenticated web access and specialized CLIs require separate grants.
- A `blocked` analysis result represents a technical blocker rather than an operator decision. Before returning it, the Job updates one progress message and autonomously attempts every useful cheap investigation while D1 retains the event and message-revision history. Cheap investigations use the existing sandbox, repository, grants, credentials, and configured services. They include web research, codebase research, and disposable local prototypes. New infrastructure, access, credentials, paid resources, or operator setup are not cheap. Flow policy sets hard limits and the agent orders work within them. A soft threshold tells the agent to finish its current investigation and preserve a coherent artifact before the hard limit blocks further capability use. The terminal result records exhausted work and the next investigation that requires such setup, authority, access, or budget. Runtime setup requests may pause and resume the same Job later.
- The first Implement Flow defaults to Level 3 direct sandbox publication. After the Job enters its publication phase, its sandbox receives a short-lived GitHub App installation token scoped to one repository with `Contents: write` and `Pull requests: write`, never the operator's personal credential or GitHub App administration permission. GitHub does not scope the token to the intended branch, and the first version does not require repository rules to enforce agent policy. One authorized Implement Invocation permits pushes to the job-owned branch and updates to its draft pull request without another approval or a separate numeric count limit; the Job's overall limits still apply. It also authorizes the repository automation normally triggered by those effects. Ornn preserves and records partial publication, then retries the remaining operation idempotently. Level 2 brokered publication and Level 1 isolated change-artifact publication follow as hardening. See [ADR 0006](../adr/0006-start-with-direct-sandbox-github-publication.md).
- D1 stores authoritative per-Job duration, limit interruption, model and tool usage, provider quota, and billed-cost records when available. Derived OpenTelemetry metrics support inspection. Those measurements guide later changes to versioned Flow limits and provider budgets.
- A flow defines the default and maximum capability grants for its jobs. The authorized invoker may request an override in the invocation prompt or a later clarification reply within operator policy. Issue text, other users' comments, and repository files cannot authorize overrides. Runtime capability requests with explicit human approval may follow later.
- Capability identity does not prescribe execution location. A flow selects a logical default provider; deployment configuration binds it to a concrete service, credential, and location. A trusted provider may execute on the Runner, route work into the sandbox, or use a separate publisher.
- Each job pins its resolved flow version and configuration. An authorized invoker may restart the work on a newer flow version, creating a new linked job rather than mutating the original job.
- Ornn will have an operator-controlled default agent profile. The authorized invoker may select another allowlisted profile per invocation. Each job records the resolved engine, model, and context configuration rather than depending only on a mutable profile name.
- Anthropic models are expected later for adversarial code review; that review is not yet part of the first slice.
- The control plane is one modular deployment managed by one operator. Internal code boundaries are not separately deployed microservices.
- Research may add alternatives when they fill a missing capability or provide a clearly stronger self-hostable comparison.
- The first implementation should arrive in days rather than weeks, but speed does not outrank control, security, or stability.
- Production-grade means reliable operation by one operator. It requires a secure authenticated entrance, strict invocation authorization, inspectable job state, and a minimal useful telemetry set. Cloudflare supplies availability for its underlying services, so Ornn does not need its own high-availability system in the first slice.
- The first path uses a Remote Runner on `homeserv1`, one Pi session and one Docker sandbox per job, configurable Runner capacity, and authenticated outbound HTTPS polling.
- The first slice uses exactly one Pi session per Job. Agent-level parallel and dependent work can be added later without changing the Job boundary.
- Every sandbox provides its standard execution environment, toolchain, and pinned repository workspace as prerequisites. Ornn does not model those basics as Capability grants; grants govern extra agent abilities and external effects.
- The Embedded Runner with Daytona remains a conditional later proof. Revisit it only with an OpenAI-supported automation credential, an exact and tested Pi Worker integration, durable capacity leases, a bounded execution window, and direct Daytona cancellation and verified-deletion support inside the Ornn adapter.
- Iroh applies to a later Remote Runner transport. Sandbox platforms remain behind the sandbox-driver interface and may use their native connections inside an adapter.

## Open evidence tickets

- [#15](https://github.com/bjesuiter/ornn-forge/issues/15) selects and pins the Pi extension for anonymous `web_fetch`.
- [#16](https://github.com/bjesuiter/ornn-forge/issues/16) benchmarks the OpenCode Go candidates and pins the routing model.
- [#17](https://github.com/bjesuiter/ornn-forge/issues/17) defines the Analyze Flow audit, provenance, retention, and inspection contract.
- [#18](https://github.com/bjesuiter/ornn-forge/issues/18) selects local Runner credential storage and the reauthentication protocol.
- [#19](https://github.com/bjesuiter/ornn-forge/issues/19) defines SandboxDriver errors, cleanup defaults, quarantine, and manual recovery.
- [#11](https://github.com/bjesuiter/ornn-forge/issues/11) orders the accepted decisions into the first implementation route after the evidence tickets close.

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

- Evaluation status: complete; retain the maintained managed API as a conditional sandbox-driver proof, not an approved Embedded Runner path or self-hosting foundation. The current TanStack provider cannot kill spawned commands and hides deletion failures, so an Ornn adapter would need direct Daytona SDK or REST operations for cancellation and verified cleanup.

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
- Which authorized abilities should Ornn grant to agents in analysis and implementation jobs?
- How does Ornn authorize, provide, restrict, and audit each job-scoped capability grant independently of the tool that implements its capability?
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
- 2026-09-04: Tested the lower-level Pi and Daytona packages in the configured Worker runtime and rejected the Embedded Runner as currently specified in [Embedded Runner with Pi and Daytona on Cloudflare](./embedded-runner-pi-daytona-cloudflare.md).
- 2026-09-04: Chose an Ornn-owned job model that composes focused components behind replaceable contracts in [Select Ornn Forge's assembly level](https://github.com/bjesuiter/ornn-forge/issues/5).
