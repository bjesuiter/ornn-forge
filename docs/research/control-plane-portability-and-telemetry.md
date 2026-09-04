# Control-plane portability and telemetry

Research date: 2026-09-04

## Question

Can Ornn Forge safely start with Durable Objects, D1 plus Drizzle, R2, and OpenTelemetry without creating an exit that exists only on paper? Where does Restate fit, and what is the smallest self-hostable way to inspect telemetry?

## Decision

Use the proposed Cloudflare baseline, with one important restriction: Durable Objects must coordinate jobs, not own irreplaceable job history.

- Store the authoritative job record and append-only job event timeline in D1 through a narrow Ornn-owned repository interface and Drizzle's SQLite schema.
- Use one Durable Object per active job to serialize transitions, manage the current lease, and schedule timeout or recovery work with an alarm. Make its state reconstructible from D1.
- Store logs and artifacts in R2 through an Ornn-owned object-store interface limited to S3 operations that R2 implements.
- Instrument the Cloudflare control plane and sandbox runners with OpenTelemetry. Treat telemetry as diagnostic data, not as the job ledger.
- Use OpenObserve when a single self-hosted telemetry backend becomes necessary. It accepts OTLP logs, metrics, and traces, includes a UI, and can run as one binary. Jaeger is a smaller permissively licensed choice if trace inspection alone is enough.
- Do not put Restate in the first build. It solves much of the durable-job problem, but it would replace Ornn's job semantics with Restate's invocation and journal model, add another stateful runtime, and fail the project's OSI-license gate today.

This is a credible exit strategy, but it is not a live migration switch. D1 and R2 have practical data-export paths. Celld currently gives Ornn a promising source-code target for its Worker and Durable Object code, not a production-ready way to transfer existing Durable Object state.

## What "portable" means here

API similarity is the weakest form of portability. This report uses four tests:

1. **Source exit.** Can Ornn run equivalent application code against another implementation without redesigning its domain model?
2. **Data exit.** Can the operator extract the authoritative records and artifacts in a documented, usable format?
3. **Operational exit.** Can one operator run the replacement securely and keep it updated?
4. **License exit.** Can the operator inspect, modify, and run the replacement indefinitely under an acceptable license?

A component does not pass merely because another product uses similar words or exposes similar methods.

## Findings by component

### Durable Objects and Celld

Durable Objects fit active job coordination well. Cloudflare documents each object as a globally unique, single-threaded coordinator with private transactional storage. Alarms provide at-least-once execution, with one scheduled alarm per object and up to six automatic retries when the handler throws. Those semantics are useful for a job lease, timeout, and recovery loop, but they require idempotent handlers and an explicit plan after the six built-in retries are exhausted. [Cloudflare's Durable Object rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) and [alarm semantics](https://developers.cloudflare.com/durable-objects/api/alarms/) define those constraints.

Celld is a real implementation, not a mock API. Version 0.4.0 embeds V8, deploys Wrangler bundles, gives each named cell its own SQLite database, and replicates durable state through operator-owned object storage. It is Apache-2.0 licensed. Its compatibility document marks Workers and Durable Objects as partial rather than complete. The listed Durable Object gaps include RPC stubs crossing isolate boundaries and outbound WebSockets surviving object movement. [Celld's architecture](https://github.com/denoland/celld/tree/v0.4.0), [license](https://github.com/denoland/celld/blob/v0.4.0/LICENSE), and [compatibility table](https://github.com/denoland/celld/blob/v0.4.0/docs/cloudflare-compat.md) support the source-exit claim.

The operational story is not ready for Ornn's daily-production requirement. Celld calls itself alpha and says it is unsafe for hostile multi-tenant use. One fleet trusts its application code, nodes, and operators. Celld does not terminate TLS, and peer traffic is plaintext unless the operator supplies a private network or encrypted overlay. Its own object-store guarantees also depend on conditional writes that some S3-compatible stores either lack or mishandle. [Celld's limitations](https://github.com/denoland/celld/blob/v0.4.0/docs/limitations.md), [security model](https://github.com/denoland/celld/blob/v0.4.0/docs/security.md), and [storage guarantees](https://github.com/denoland/celld/blob/v0.4.0/docs/guarantees.md) make these responsibilities explicit.

Celld also has no documented tool for importing the state of existing Cloudflare Durable Object namespaces. Cloudflare's Durable Object storage API offers point-in-time restore inside Cloudflare, but its documentation does not expose a general database export path. Cloudflare's "migrations" manage class lifecycle inside the platform, not movement to another runtime. [Cloudflare's SQLite-backed storage documentation](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) and [class migration documentation](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) show the distinction.

Verdict:

- **Source exit: credible for a tested subset.** Pin a Celld version in a compatibility test and avoid unsupported runtime features.
- **Data exit: not credible for Durable Object-owned state.** There is no documented Cloudflare-to-Celld state transfer.
- **Operational exit: future option, not current failover.** Celld 0.4.0 is alpha and shifts network, ingress, update, and object-store correctness work to the operator.
- **License exit: passes.** Celld uses Apache-2.0.

The architecture should therefore treat the Durable Object as a recoverable coordinator. It may cache the active state, serialize commands, and schedule the next wake-up. D1 must retain the authoritative job state and event history. A replacement coordinator can rebuild from that history without extracting private Durable Object storage.

Ornn should add a small compatibility test suite for the Durable Object features it actually uses: RPC or HTTP dispatch, SQLite or key-value writes if any remain, alarm scheduling and retry behavior, and process restart. Run it against Miniflare and a pinned Celld release. Do not claim general Workers compatibility from those tests.

### D1 and Drizzle

D1 uses SQLite's query engine and supports most SQLite SQL conventions, but not every pragma or extension. One D1 database processes queries on a single thread. Current documented limits include 10 GB per paid database, 2 MB per row or value, 100 bound parameters, and 30 seconds per query. [D1 SQL compatibility](https://developers.cloudflare.com/d1/sql-api/sql-statements/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) are the constraints Ornn needs to design against.

Drizzle gives this choice a useful code exit. Its D1 adapter and its `libsql`, `node:sqlite`, and `better-sqlite3` adapters share the `sqlite-core` schema and SQLite query model. Drizzle Kit can generate versioned SQL migrations and operate against D1's HTTP API. Drizzle is Apache-2.0 licensed. [Drizzle's D1 adapter](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1), [SQLite adapters](https://orm.drizzle.team/docs/get-started/sqlite-new), [D1 migration tooling](https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit), and [repository license](https://github.com/drizzle-team/drizzle-orm/blob/main/LICENSE) establish that code path.

Drizzle does not make D1 transparent. The application must still change the driver and connection setup when it moves. D1-specific extensions, replication sessions, batch behavior, and platform limits can leak through raw SQL or adapter-specific methods. A shared schema reduces migration work, but it does not prove behavioral compatibility.

D1 has a documented SQL export. The export is useful for a small single-operator database, but it blocks other database requests while running. Virtual tables cannot be exported, and the dump needs edits before D1 can import it again. JavaScript number precision also affects large integers. [Cloudflare's D1 import and export guide](https://developers.cloudflare.com/d1/best-practices/import-export-data/) records these limits.

Verdict:

- **Source exit: credible with discipline.** Keep Ornn's database code on standard SQLite types and SQL, and put the Drizzle instance behind an Ornn repository interface.
- **Data exit: credible for the expected scale.** Versioned SQL migrations plus D1's SQL export provide a practical move to SQLite, libSQL, or another database after a conversion step.
- **Operational exit: credible.** A single SQLite or libSQL deployment is within one operator's reach.
- **License exit: passes for Drizzle.** Drizzle uses Apache-2.0.

The first schema should avoid virtual tables, D1-only SQL, and integers that cross JavaScript's safe range. Store identifiers as text. Keep checked-in SQL migrations. Add a test that runs the same repository contract against D1 local development and one non-D1 SQLite driver.

### R2 behind an S3 contract

R2 exposes three different APIs: a Workers binding, an S3-compatible HTTP API, and Cloudflare's management API. Cloudflare recommends the S3-compatible API for existing S3 SDKs and tools. The compatibility table also makes clear that R2 implements a subset of S3, with per-operation feature gaps and different checksum support. [R2 API choices](https://developers.cloudflare.com/r2/api/), [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/), and [AWS SDK setup](https://developers.cloudflare.com/r2/get-started/s3/) document both facts.

For Ornn, the useful artifact operations are small: put an immutable object, get it, inspect metadata, list by a job-scoped prefix, delete by retention policy, and optionally use multipart upload for large logs. Those operations fit the implemented S3 subset. R2 provides strong consistency for object reads, writes, deletes, metadata, and listings through its binding and S3 APIs. [R2's consistency model](https://developers.cloudflare.com/r2/reference/consistency/) supports using the bucket as durable artifact storage.

Using an R2 Worker binding everywhere would make the application code Cloudflare-specific. Using the complete S3 API would expose features that R2 does not implement. The right boundary is an Ornn-owned `ArtifactStore` contract with S3 semantics and a deliberately small operation set. Its first implementation may use the zero-credential R2 binding inside Workers. A second S3 implementation can use an endpoint, region, bucket, and scoped credentials. The conformance test should run against both R2 and MinIO before Ornn calls the exit proven.

Verdict:

- **Source exit: credible behind the narrow contract.** It is an adapter change, not zero-change portability.
- **Data exit: credible.** Standard S3 tools can read and copy the objects.
- **Operational exit: credible.** Several independently operable S3-compatible stores exist, though each must pass Ornn's chosen operation tests.
- **License exit: belongs to the replacement.** The R2 service itself is managed. Ornn must choose an acceptable self-hosted S3 replacement when it proves this exit.

Do not use bucket notifications, R2-specific metadata behavior, or Cloudflare's management API in the job model. Treat object keys and checksums as Ornn concepts, and record the artifact's hash and storage key in D1.

### OpenTelemetry across Cloudflare and sandbox runners

OpenTelemetry is suitable as Ornn's instrumentation standard because OTLP preserves the telemetry data model across collectors and backends. The Collector can run as one binary and route the same signals to another backend later. The project recommends sending production JavaScript telemetry through a Collector rather than coupling the application to a backend exporter. The specification and Collector are Apache-2.0 licensed. [OpenTelemetry's JavaScript exporter guide](https://opentelemetry.io/docs/languages/js/exporters/), [Collector deployment patterns](https://opentelemetry.io/docs/collector/deploy/), and [Collector license](https://github.com/open-telemetry/opentelemetry-collector/blob/main/LICENSE) describe that path.

Cloudflare's native Workers tracing now creates platform spans and supports custom application spans. Cloudflare can export traces and logs to an OTLP endpoint without an in-process OpenTelemetry SDK. Metrics export is not available. The feature is also still in open beta. Cloudflare does not propagate trace IDs to external services yet, custom spans cannot expose their span context, and some CPU-only spans report zero duration because the runtime clock advances around I/O. [Cloudflare's OTLP export guide](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/), [custom span API](https://developers.cloudflare.com/workers/observability/traces/custom-spans/), and [known limitations](https://developers.cloudflare.com/workers/observability/traces/known-limitations/) define the current boundary.

That propagation gap matters. The control-plane trace cannot yet become the parent of a sandbox-runner trace through Cloudflare's native API. Ornn should correlate both sides with stable attributes such as `ornn.job.id`, `ornn.invocation.id`, `ornn.capability.name`, `ornn.runner.id`, and `github.delivery.id`. Do not manufacture a fake parent-child relationship. When Cloudflare exposes W3C Trace Context propagation, Ornn can add real `traceparent` propagation. OpenTelemetry defines W3C Trace Context as the standard cross-process mechanism. [OpenTelemetry's propagation specification](https://opentelemetry.io/docs/specs/otel/context/api-propagators/) is the contract to adopt later.

Sandbox runners have a less constrained runtime. A Node-based runner can use the OpenTelemetry JavaScript SDK and OTLP/HTTP or OTLP/gRPC exporters. JavaScript traces and metrics are stable; the JavaScript log SDK remains in development as of this research date. A Collector on the runner host can receive process telemetry, enrich it with host attributes, buffer it, and forward it to the backend. [OpenTelemetry JavaScript signal status](https://opentelemetry.io/docs/languages/js/) and [the Collector agent pattern](https://opentelemetry.io/docs/collector/deploy/agent/) support this layout.

OpenTelemetry must not become Ornn's only audit history. Sampling, exporter failures, backend retention, and Cloudflare's beta limitations all make telemetry lossy by design. The minimum inspectable job consists of:

- an append-only job event timeline in D1 with state transitions, capability starts and finishes, retry decisions, cancellation, errors, and cleanup;
- concise progress and the final artifact on GitHub;
- complete sanitized agent logs and large diagnostic bundles in R2;
- OpenTelemetry traces, logs, and metrics for cross-component diagnosis.

Telemetry must never contain GitHub installation tokens, model credentials, repository secrets, full webhook signatures, or raw untrusted content by default. Attributes should use bounded identifiers and enums. Raw work-order text and agent transcripts belong in access-controlled artifacts with an explicit retention policy.

## Self-hostable telemetry backends

### OpenObserve

OpenObserve is the best match when Ornn needs one small deployment that accepts every OTLP signal. The open-source edition is AGPL-3.0. It runs as one binary, accepts OTLP/HTTP and OTLP/gRPC logs, metrics, and traces, and includes storage and a query UI. In local mode it stores metadata in SQLite and can store stream data on local disk or S3-compatible object storage. [OpenObserve's project page](https://github.com/openobserve/openobserve), [OTLP ingestion guide](https://openobserve.ai/docs/ingestion/logs/otlp/), and [storage modes](https://openobserve.ai/docs/administration/maintenance/storage-management/storage/) document that shape.

This is small enough for one operator, but it is still another database and public authenticated endpoint for Cloudflare to reach. AGPL is acceptable only as a standalone component under the project's stated license rule. Keep the OTLP boundary so OpenObserve can be replaced without touching Ornn's instrumentation.

### Jaeger

Jaeger is the smaller and more conservative option when Ornn only needs trace search. It is a CNCF project under Apache-2.0, and its all-in-one process includes OTLP ingestion, query, and a UI. The quick-start uses in-memory storage, which is not suitable for production. Persistent operation needs a configured storage backend. Jaeger does not replace log search or metrics storage. [Jaeger's repository](https://github.com/jaegertracing/jaeger) and [deployment documentation](https://www.jaegertracing.io/docs/latest/deployment/) define those limits.

Jaeger is viable if D1 remains the job timeline and R2 remains the log archive. In that layout traces answer timing and causal questions, while Ornn's own records answer "what happened to this job?"

### Uptrace

Uptrace provides one UI for traces, metrics, and logs and uses OpenTelemetry ingestion. Its self-hosted stack requires ClickHouse for telemetry and PostgreSQL for metadata. The current project is AGPL-3.0. That is more operational weight than OpenObserve for Ornn's first slice. [Uptrace's repository](https://github.com/uptrace/uptrace) describes the required databases and license.

### Recommendation

Start the application with the D1 event timeline, R2 log artifacts, Cloudflare's built-in trace viewer, and structured local runner logs. Add OpenObserve as the first OTLP backend when the first cross-component diagnosis requires retained search outside Cloudflare. This keeps the first build within days and does not weaken the production audit trail because the audit trail lives in Ornn's stores.

If immediate end-to-end trace search is a first-slice acceptance criterion, deploy OpenObserve from day one. Use Jaeger instead only if trace-only inspection and Apache-2.0 matter more than unified log and metric search.

## Restate comparison

Restate overlaps strongly with Ornn's proposed durable job model. It provides idempotency keys, durable workflows, retries, timers, external-event promises, cancellation, invocation journals, a UI and CLI for inspection, and OTLP trace export. Its TypeScript SDK can run a service handler on Cloudflare Workers. The Restate server remains a separate stateful runtime that invokes that public Worker endpoint. [Restate's workflow model](https://docs.restate.dev/use-cases/workflows), [invocation lifecycle](https://docs.restate.dev/services/invocation/managing-invocations), [introspection](https://docs.restate.dev/services/introspection), [tracing](https://docs.restate.dev/server/monitoring/tracing), and [Cloudflare deployment guide](https://docs.restate.dev/services/deploy/cloudflare-workers) show the overlap.

Self-hosting can be operationally modest at first. Restate offers a single binary with persistent local disk for a single node. A clustered production deployment introduces Restate's replicated log, metadata, snapshots, and supported object-store constraints. [Restate's self-hosted overview](https://docs.restate.dev/server/overview) documents those choices.

The runtime uses Business Source License 1.1, not an OSI-approved license. Its additional grant permits production deployments that invoke the operator's own services, but prohibits a public Restate platform service that exposes Restate APIs to third parties. Each release changes to Apache-2.0 after four years. [Restate's license](https://github.com/restatedev/restate/blob/main/LICENSE) is explicit on those terms.

For Ornn, the larger problem is ownership. A Restate workflow would make Restate's invocation ID, journal, retry rules, service protocol, retention, and deployment registration part of the durable execution model. Moving away would require translating live journals or letting old jobs drain while a new engine starts. That is much more coupling than an internal capability interface over D1 and a Durable Object coordinator.

Verdict: do not use Restate in the first slice. Revisit it only if implementing reliable suspension, replay, cancellation, and compensation on Durable Objects becomes the dominant engineering cost. A future evaluation should compare a small working Ornn job on both implementations and require a drain-and-cutover plan. Restate's license would still need an explicit exception to the current OSI requirement.

## Required contracts and tests

The baseline remains replaceable only if the implementation enforces these boundaries.

### Job repository

Own the job, delivery-deduplication, event, lease, and artifact-metadata schemas. Expose domain operations rather than a raw D1 binding. Test the same behavior on D1 and another SQLite driver. Keep SQL migrations in version control and exercise an export/import recovery drill.

### Job coordinator

Define transitions, leases, retry decisions, timeout behavior, and cleanup in Ornn code. Keep Durable Object storage reconstructible. Test duplicate commands, process restarts, repeated alarms, exhausted alarm retries, and recovery from the D1 event timeline. Run the selected API subset against Miniflare and a pinned Celld release.

### Artifact store

Limit the interface to immutable put, get, metadata, prefix list, and delete operations. Record hashes in D1. Test R2 and one self-hosted S3 implementation with the same suite, including multipart behavior if the first slice needs it.

### Telemetry sink

Instrument capabilities against OpenTelemetry APIs or Cloudflare's native custom spans. Configure exporters outside domain code. Require the stable `ornn.*` correlation attributes on control-plane and runner signals. Verify that a failed exporter cannot fail or stall a job.

## Risks that remain

- Celld is moving quickly. Version 0.4.0 arrived in August 2026 and still labels itself alpha. Pin it only in an exit test, not in production.
- There is no verified transfer path for live Cloudflare Durable Object storage. The D1-authoritative design removes that dependency but needs a tested coordinator rebuild path.
- D1 export briefly stops database service. At Ornn's initial scale, a maintenance window is acceptable. That assumption must change before the database carries multi-operator workloads.
- R2 implements an S3 subset. Every new artifact-store feature must pass the self-hosted S3 conformance suite before entering the Ornn contract.
- Cloudflare's native OTel export and custom spans are beta, lack metrics, and cannot yet link traces to the runner. Stable job identifiers must carry correlation until W3C context propagation works.
- OpenObserve's AGPL license is acceptable only while it remains a separate program. Modifying or embedding it needs a license review.

## Final assessment

The Cloudflare baseline is suitable for the first build if Ornn owns its job model and makes Durable Object state disposable. D1 plus Drizzle and R2 behind a small S3-shaped interface have real code and data exits. OpenTelemetry has a strong protocol exit, with OpenObserve as the smallest useful unified self-hosted backend. Celld is valuable as a compatibility target and future self-hosted runtime, but today it proves source portability only. Restate offers more durable-execution machinery, yet its license and much deeper control over job semantics make it the wrong starting point for this project.
