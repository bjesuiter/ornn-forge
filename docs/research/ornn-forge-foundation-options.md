# Ornn Forge foundation options

## Purpose

This document records the options considered for assembling Ornn Forge and the evidence gathered about them. It is a working research record, not yet a recommendation.

The decision sought is a build-ready direction for a production-grade first slice that handles one real GitHub repository from invocation through an analysis artifact.

## Current decision criteria

### Hard requirements

- Ornn must not depend on an application component or managed service without a credible exit to an independently operable replacement.
- Ornn must own the overall system shape, including its GitHub contract, job model, deployment, and sandbox boundary.
- Ornn must be assembled from a small set of independently testable, observable capabilities. Higher-order workflows should compose those capabilities rather than hide them inside one framework-controlled operation.
- The system must support replaceable sandbox runners, with one runner implementation integrated initially.
- Daytona and user-owned machines must be able to supply sandbox capacity through the same Ornn-owned contract.
- The agent engine must be replaceable independently from the sandbox runner and model provider.
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
- The initial agent engine will be Codex or pi using the user's OpenAI subscription. The engine choice remains open, and the available OpenAI model variant should be selectable at runtime.
- Ornn will have an operator-controlled default agent profile. The authorized invoker may select another allowlisted profile per invocation. Each job records the resolved engine, model, and context configuration rather than depending only on a mutable profile name.
- Anthropic models are expected later for adversarial code review; that review is not yet part of the first slice.
- The control plane is one modular deployment managed by one operator. Capabilities are internal code boundaries, not microservices.
- Research may add alternatives when they fill a missing capability or provide a clearly stronger self-hostable comparison.
- The first implementation should arrive in days rather than weeks, but speed does not outrank control, security, or stability.
- Production-grade means reliable operation by one operator. It requires a secure authenticated entrance, strict invocation authorization, inspectable job state, and a minimal useful telemetry set. Cloudflare supplies availability for its underlying services, so Ornn does not need its own high-availability system in the first slice.
- Research may select the first sandbox runner. A user-owned runner follows as the next proof of the sandbox-runner contract and is not required before the first repository flow.
- Iroh applies to an Ornn-built runner on user-owned machines. Other sandbox runners may use their native APIs behind the same Ornn-owned contract.

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

- Evaluation status: not started.
- User context: OpenClaw currently uses itself in its development workflow.
- User context: it is opinionated, changing quickly, and does not currently appear adjustable enough for Ornn's needs.
- Question: could it provide a disposable route to the first slice without owning Ornn's durable concepts?

#### GitHub Agentic Workflows, `gh-aw`

- Evaluation status: not started.
- User context: capabilities and fit are not yet known.
- Question: can it provide useful GitHub-native workflow pieces while preserving self-hosting and control?

### Building blocks

#### Sandcastle

- Source: https://github.com/mattpocock/sandcastle
- Evaluation status: not started.
- Question: which orchestration, sandbox, and agent-execution responsibilities does it own, and can those parts be adopted independently?

#### TanStack AI sandbox approach

- Source: https://tanstack.com/blog/run-coding-agents-in-a-sandbox
- Evaluation status: not started.
- Question: what abstraction does it provide over coding-agent sandboxes, and where would Ornn need its own lifecycle boundary?

#### Flue 2

- Source: https://flueframework.com/blog/flue-2/
- Evaluation status: not started.
- Question: can its workflow model support durable, inspectable jobs without taking control of Ornn's domain model?

### Lower-level implementation options

#### pi coding agent SDK

- Source: https://pi.dev/
- Evaluation status: not started.
- Question: how much agent execution behavior does it supply, and what orchestration would Ornn still need to own?

#### Tardigrade

- Source: https://github.com/clavia-labs/tardigrade
- Evaluation status: not started.
- Question: which durable execution or agent-runtime responsibilities can it supply as a self-hosted component?

### Level still to classify

#### Restate

- Source: https://docs.restate.dev/
- Evaluation status: not started.
- Question: is Restate best treated as the durable control plane, one building block inside it, or unnecessary machinery for Ornn's scale?

#### Celld

- Evaluation status: not started.
- User context: Celld, by Ryan, is believed to provide a self-hostable implementation compatible with Cloudflare Durable Objects.
- Question: how complete is that compatibility, what migration path does it support, and is it credible enough to make Durable Objects reversible?

#### Iroh

- Evaluation status: not started.
- User context: Iroh is the preferred connection layer for an Ornn-built sandbox runner.
- User context: the Cloudflare control plane may connect to a runner through public Iroh relays, with the option to replace those relays later.
- Question: can Iroh provide the authenticated, replaceable connection layer while Ornn retains ownership of runner enrollment, authorization, leasing, and job state?

#### EvLog

- Source: https://www.evlog.dev/
- Evaluation status: set aside before evaluation.
- Reason: OpenTelemetry is the preferred standard for instrumentation and telemetry transport.

#### OpenTelemetry

- Source: https://opentelemetry.io/docs/what-is-opentelemetry/
- Evaluation status: preliminary choice; Cloudflare runtime fit and backend remain to be researched.
- Finding: OpenTelemetry is an open-source, vendor-agnostic framework for generating, collecting, and exporting traces, metrics, and logs. It defines APIs, SDKs, conventions, and the OTLP protocol.
- Finding: OpenTelemetry explicitly does not provide the storage backend or visualization frontend. Ornn must still select where telemetry is retained and how the operator inspects it.
- Question: which OpenTelemetry SDK and export path work reliably in the Cloudflare control plane and sandbox runners, and what self-hostable backend should store the first slice's telemetry?

## Open comparison questions

- Which responsibilities must Ornn own to preserve a cheap exit from every dependency?
- What is the smallest useful set of Ornn capabilities from which analysis and implementation jobs can be composed?
- What contract makes each capability independently testable without forcing all capabilities into one process or deployment?
- Can a temporary full solution be isolated behind the same contracts intended for the long-term system?
- What isolation mechanism should a user-owned machine provide for untrusted repository work?
- What protocol should connect sandbox runners, including user-owned machines, to the control plane?
- What minimal telemetry makes every job inspectable without requiring a custom dashboard?
- Where should OpenTelemetry data be stored and inspected in the first slice?
- Which candidates are actually self-hostable under licenses and deployment models acceptable for this project?
- Are the proposed exit paths from Durable Objects, D1, R2, and model APIs technically credible rather than merely similar in concept?
- Which composition can plausibly deliver the first production-shaped repository flow within a few days?

## Evaluation log

No evaluations completed yet.
