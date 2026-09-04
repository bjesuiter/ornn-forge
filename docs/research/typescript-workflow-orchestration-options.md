# TypeScript workflow orchestration options

Research date: 2026-09-04

## Question

Should Ornn Forge implement job orchestration as Ornn-owned TypeScript state transitions over Durable Objects and D1 with Drizzle, or adopt an existing TypeScript workflow library above or alongside those services?

The comparison tests each option against four constraints:

- Ornn owns the meaning and durable history of an invocation, work order, job, capability, and artifact.
- The first control plane runs on Cloudflare.
- D1 remains the authoritative job and event store unless a stronger choice justifies changing that decision.
- Every dependency needs a credible code, data, operating, and license exit.

## Recommendation

Prototype TanStack Workflow before selecting the coordinator. It is the only candidate with first-party Cloudflare and D1 packages, a small host and store boundary, and the durable behavior Ornn would otherwise have to build.

Do not make TanStack Workflow authoritative. Ornn's job record and append-only event timeline must remain in Ornn-owned D1 tables. TanStack's event history, timers, and leases may implement job execution behind an adapter. This separation is required by [ADR 0001](../adr/0001-ornn-owns-the-job-model.md).

If the prototype fails, return to a small Ornn-owned state machine over D1 and one Durable Object per active job. Flowcraft and OpenWorkflow are fallback prototype candidates only when the failure points to a capability they handle better. Reject the other candidates for the first slice.

## Comparison

| Candidate | What it is | Cloudflare and D1 fit | Decision |
| --- | --- | --- | --- |
| TanStack Workflow | Durable replay runtime with steps, signals, timers, schedules, versions, and leases | First-party Cloudflare host and D1 store, but experimental `0.0.x` packages | Prototype first |
| Flowcraft | Graph workflow runtime with a distributed Cloudflare adapter | Requires Queues, Durable Object storage, and KV; no D1 adapter | Fallback prototype only |
| OpenWorkflow | Database-backed replay runtime with polling workers and leases | Clear backend interface, but no D1 backend and its worker assumes a continuous Node or Bun process | Fallback prototype only |
| Workflow SDK | Event-sourced durable runtime with pluggable Worlds | Worker runtime currently depends on `node:vm`; custom World is large | Defer |
| Effect Workflow | Durable workflow layer backed by Effect Cluster | SQL clients exist for D1 and Durable Objects, but no first-party Cloudflare workflow host exists | Defer |
| `@durable-effect/workflow` | Effect workflow replay on Durable Objects | Direct platform fit, but explicitly experimental and pre-release | Reject for now |
| Flowcraft local runtime | In-memory graph execution | Worker eviction loses progress | Not sufficient alone |
| ts-edge | Typed in-process graph traversal | No persistence, resume, or reconciliation contract | Reject |
| ez-flow | In-process composite control flow | No persistence, timers, leases, or recovery | Reject |
| Orbits | Mongo-backed persistent action and SAGA runtime | Mongo-only persistence and Node cron runtime conflict with D1 and Workers | Reject |

## TanStack Workflow

TanStack Workflow restarts a workflow function from the beginning and replays an append-only event history. Completed named steps return their recorded results instead of repeating their side effects. It provides durable signals, approvals, timers, schedules, version routing, execution leases, and stale-run recovery. See the [overview](https://github.com/TanStack/workflow/blob/main/docs/overview.md), [replay model](https://github.com/TanStack/workflow/blob/main/docs/concepts/replay-and-resume.md), and [persistence guide](https://github.com/TanStack/workflow/blob/main/docs/guide/persistence.md).

The project includes a [Cloudflare host package](https://github.com/TanStack/workflow/tree/main/packages/workflow-cloudflare) and a [D1 store](https://github.com/TanStack/workflow/tree/main/packages/workflow-store-cloudflare-d1). A scheduled Worker calls a bounded sweep. D1 determines which timers and runs are due. The repository mentions Durable Objects as a possible custom store, but it does not provide a Durable Object store package.

The boundary is promising. `WorkflowExecutionStore` owns runs, events, timers, signal deliveries, schedules, and leases. The Cloudflare package owns its `workflow_*` tables and [schema migrations](https://github.com/TanStack/workflow/blob/main/packages/workflow-store-cloudflare-d1/SCHEMA_MIGRATIONS.md). Ornn should treat those tables as replaceable runtime data, not its job ledger.

The risk is maturity. The repository started in May 2026. Its packages are `0.0.x`, and the documentation calls the runtime and capability adapters experimental. Workflow functions also depend on TanStack APIs such as `createWorkflow`, `ctx.step`, `ctx.sleep`, and `ctx.waitForEvent`. Persisted histories follow TanStack's replay and version rules.

The D1 implementation needs fault testing. Source review found multi-call write sequences in event append and signal delivery. Unique constraints and compare-and-set checks detect some races, but a crash between calls may leave partial state. See the [D1 store implementation](https://github.com/TanStack/workflow/blob/main/packages/workflow-store-cloudflare-d1/src/store.ts).

### Prototype acceptance tests

The prototype should stay outside production code and answer these questions:

1. Can the same invocation start only one workflow after duplicate GitHub deliveries?
2. What happens when the process stops after an external capability succeeds but before the step result is recorded?
3. What happens when D1 fails during a multi-event append or signal delivery?
4. Can two concurrent signals or resume attempts produce one valid job transition?
5. Does a missed scheduled sweep recover an overdue timer without losing or repeating work incorrectly?
6. Can an old workflow version finish after a new version deploys?
7. Can Ornn reconstruct the complete job result using only its own D1 tables and R2 artifacts?
8. Can a simple Drizzle coordinator replace TanStack while preserving Ornn's public job contract?
9. Does a failed telemetry exporter leave workflow progress unchanged?

Accept TanStack only if it passes these tests without copying its event types, run states, or identifiers into Ornn's domain model.

## Flowcraft

Flowcraft has a durable distributed mode with conditions, loops, parallel joins, retries, fallback, timeouts, cancellation, sleep, event waits, human approval, subflows, versions, and reconciliation. Its plain `FlowRuntime` remains in memory. See the [repository](https://github.com/gorango/flowcraft) and [distributed execution guide](https://flowcraft.js.org/guide/distributed-execution).

Its official [Cloudflare adapter](https://flowcraft.js.org/guide/adapters/cloudflare) uses Queues for work, Durable Object storage for coordination and joins, and KV for status. It has no D1 or Drizzle adapter. Adopting that package would add two Cloudflare services and make Durable Object storage authoritative.

The adapter also needs verification before production use. Its source assumes conditional Durable Object writes and storage expiry behavior that Cloudflare's SQLite storage documentation does not expose in the same form. The guide leaves part of the Durable Object routing layer to the application. See Flowcraft's [Cloudflare store implementation](https://github.com/gorango/flowcraft/blob/master/packages/adapters/cloudflare/src/store.ts) and Cloudflare's [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

Flowcraft is active and MIT licensed. It deserves a prototype only if Ornn accepts Queues, KV, and Flowcraft-owned coordination state, or if TanStack fails and a small D1-authoritative Flowcraft adapter appears practical.

## OpenWorkflow

OpenWorkflow stores workflow runs and completed step results in a database. Stateless workers claim runs with leases and replay workflow functions. It supports retries, sleeps, signals, cancellation, versions, child workflows, and idempotency keys. See its [overview](https://openworkflow.dev/docs/overview), [production model](https://openworkflow.dev/docs/production), and [feature roadmap](https://openworkflow.dev/docs/roadmap).

The project ships PostgreSQL and Node or Bun SQLite backends, not D1. Its custom [Backend interface](https://github.com/openworkflowdev/openworkflow/blob/main/packages/openworkflow/core/backend.ts) is explicit and smaller than Workflow SDK's World interface, so a Drizzle implementation is plausible.

The host model is the problem. The official [Worker implementation](https://github.com/openworkflowdev/openworkflow/blob/main/packages/openworkflow/worker/worker.ts) uses a continuous polling loop and lease heartbeats. Cloudflare Workers need a scheduled wake-up or Durable Object alarm instead. A fallback prototype would test whether one bounded `tick()` can run safely from that host without maintaining a large fork.

OpenWorkflow is Apache-2.0 and active, but still before version 1. Its durable records use OpenWorkflow's run and step-attempt model, so removal requires a data migration or a clean separation from Ornn's job ledger.

## Workflow SDK

Workflow SDK uses `"use workflow"` for orchestration and `"use step"` for cached, retryable side effects. It stores an append-only event log and materialized views. The selected World supplies storage, queues, streams, hooks, analytics, and protocol support. See its [event-sourcing design](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/how-it-works/event-sourcing.mdx) and [World interfaces](https://github.com/vercel/workflow/blob/main/packages/world/src/interfaces.ts).

The official [Postgres World](https://workflow-sdk.dev/worlds/postgres) needs PostgreSQL, Graphile Worker, and a long-running process. A community Cloudflare World exists, but the workflow runtime currently depends on `node:vm`. The project's [Cloudflare Workers issue](https://github.com/vercel/workflow/issues/2028) reports that this dependency prevents execution even with `nodejs_compat`.

The authoring model is strong, and the project supports retries, durable sleep, hooks, cancellation, deployment pinning, and stable step IDs. It is Apache-2.0 and active. The current runtime blocker rules it out. Building and maintaining a complete D1 World would also cost too much for the first slice.

## Effect options

Official [`@effect/workflow`](https://github.com/Effect-TS/effect/tree/v3/packages/workflow) provides typed workflows, activities, durable clocks, deferred values, queues, retries, and compensation. Its production engine uses [Effect Cluster](https://github.com/Effect-TS/effect/tree/v3/packages/cluster), including sharding, persisted message storage, runner registration, locks, and runner lifecycle.

Effect supplies [`@effect/sql-d1`](https://github.com/Effect-TS/effect/tree/v3/packages/sql-d1) and [`@effect/sql-sqlite-do`](https://github.com/Effect-TS/effect/tree/v3/packages/sql-sqlite-do). These packages solve database access, not the Cloudflare host, wake-up, transport, and runner lifecycle. The official cluster transports target long-running Node, Bun, or Deno processes. Version 4 also moves these APIs under unstable packages, which raises the short-term upgrade cost.

Effect Workflow makes sense when an application already commits to Effect and Effect Cluster. Ornn has not made that choice. Adopting it now would couple capability code, schemas, service wiring, durable messages, and operations to Effect.

[`@durable-effect/workflow`](https://github.com/backpine/durable-effect/tree/main/packages/workflow) has a more direct Durable Object design with step replay, durable sleeps, and retries. Its package is an explicitly experimental `0.0.1-next` release. It is too early for the first production slice.

## In-process helpers

### ts-edge

[ts-edge](https://github.com/cgoinglove/ts-edge) provides typed graphs, dynamic routing, parallel branches, joins, middleware, events, timeouts, and visit limits. Its execution history and graph state live in process memory. The [runtime](https://github.com/cgoinglove/ts-edge/blob/main/src/core/runable.ts) and [store](https://github.com/cgoinglove/ts-edge/blob/main/src/core/store.ts) have no persistence, serialization, resume, or reconciliation contract.

It may bundle for Workers, but Worker eviction loses the job. Ornn would still need to implement every durable behavior. The extra graph abstraction does not pay for itself.

### ez-flow

[ez-flow](https://github.com/rstanziale/ez-flow) composes sequential, conditional, repeated, and parallel functions. Its workflow engine calls the workflow directly, and its work context is an in-memory map. It has no durable wait, event history, lease, timer, recovery, or reconciliation support.

It is useful as a small control-flow library, not as Ornn's job coordinator.

## Orbits

[Orbits](https://github.com/LaWebcapsule/orbits) persists actions and uses database locks, repeated watchers, and SAGA-style rollback. Workflow code replays its definition while stored action results prevent completed work from repeating. See the [action model](https://orbits.do/documentation/core-concepts/action/), [workflow model](https://orbits.do/documentation/core-concepts/workflow/), and [runtime](https://orbits.do/documentation/core-concepts/runtime/).

The [quick start](https://orbits.do/documentation/quickstart/) states that MongoDB is the only supported database. The runtime opens that database connection and starts cron-driven action workers. Replacing MongoDB with D1 would require new persistence, locking, scheduling, and runtime code. Orbits also lacks documented equivalents for several signals, cancellation, durable timers, and versioning features found in the stronger candidates.

## Resulting decision tree

```text
prototype TanStack Workflow
  passes isolation and recovery tests
    keep Ornn Job and event tables authoritative
    use TanStack only as a replaceable execution adapter
  fails because the experimental D1 runtime is unsafe
    build a small Ornn-owned coordinator over D1 + Durable Objects
  fails because required workflow behavior is missing
    prototype OpenWorkflow if its bounded tick can fit Cloudflare
    prototype Flowcraft only if its extra Cloudflare services are acceptable
```

The prototype must resolve this choice before Ornn selects its durable control-plane stack.
