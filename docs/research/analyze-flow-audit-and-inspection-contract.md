# Analyze Flow audit and inspection contract

## Decision

The first Analyze Flow needs one authoritative D1 ledger, not a second observability or workflow database. Immutable domain records establish the Invocation, resolved Job, lease, grants, messages, and artifacts. An append-only `domain_events` stream records everything that happens to them. Small mutable summary tables may make reads and optimistic concurrency practical, but they are rebuildable projections and never replace the event history.

The authenticated operator reads that ledger through a small Ornn-owned JSON API. A Remote Runner can append only allowlisted events for the one current lease named by its control-plane-signed grant; it has no Job-list or arbitrary-record endpoint. Workers Observability and OpenTelemetry remain lossy derived diagnostics. Sanitized R2 diagnostics expire after 30 days while their D1 metadata and hashes remain.

No operator decision is required. The narrow defaults below satisfy the already accepted boundaries in [Select the durable control-plane and telemetry stack](https://github.com/bjesuiter/ornn-forge/issues/7#issuecomment-5545466122), [Define Ornn Forge's flow and capability boundaries](https://github.com/bjesuiter/ornn-forge/issues/8#issuecomment-5553038749), and the in-progress [first-slice security and inspectability contract](https://github.com/bjesuiter/ornn-forge/issues/9). They do not select a dashboard, analytics system, new Cloudflare service, or final Runner transport credential.

## Why D1 is the authority

D1 exposes SQLite semantics, enforced foreign keys, unique indexes, and transactional `batch()` calls. A D1 batch executes its statements sequentially and rolls the entire sequence back if a statement fails. Those properties are enough for an append-only event stream with optimistic stream revisions, idempotency constraints, and transactionally updated projections. [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 SQL compatibility](https://developers.cloudflare.com/d1/sql-api/sql-statements/), [foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), and [index guidance](https://developers.cloudflare.com/d1/best-practices/use-indexes/) document the primitives.

The schema must stay comfortably below D1's current 2 MB maximum row/string/BLOB size, 100 bound parameters per statement, and 10 GB paid-database size. The limits are ceilings, not target payload sizes. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

### Storage boundaries

| Store | Authoritative content | Explicitly not authoritative |
| --- | --- | --- |
| D1 | Domain identities, accepted source snapshots, resolved configuration, event history, message revisions, structured analysis artifact, R2 metadata and hashes, retention state | Large raw logs, model transcripts, provider consoles |
| R2 | Immutable bytes referenced by D1: sanitized diagnostic bundles and bounded evidence too large for the D1 record | Locks, deduplication, current Job state, the only copy of an analysis result |
| Workers Observability / OTLP | Derived logs, spans, and metrics correlated with stable Ornn IDs | Authorization, state transitions, billing truth, cancellation truth, cleanup truth |
| GitHub | User-visible source and mirror: issue/comment provenance, progress, clarification, final rendered analysis | Ornn's structured message history, Job state, the only copy of an artifact |
| TanStack Workflow | Internal execution journal and replay mechanics | Ornn IDs, policy, leases, audit history, artifact identity |

R2 reads, writes, deletes, metadata operations, and listings are strongly consistent through the Worker binding and S3 API. That supports immutable object bytes, but uniqueness still belongs to D1 so the same contract works against Garage. [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)

OpenTelemetry defines telemetry models and transport, not the storage or visualization backend. Its trace SDK deliberately supports sampling, and Workers Logs supports head sampling and retains data for at most seven days. It therefore cannot serve as an audit ledger even at a configured sampling rate of 100%. [What is OpenTelemetry?](https://opentelemetry.io/docs/what-is-opentelemetry/), [OpenTelemetry trace sampling](https://opentelemetry.io/docs/specs/otel/trace/sdk/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

## Authoritative D1 records

All Ornn IDs are application-generated opaque text with a type prefix and at least 128 random bits; IDs are never authorization secrets. Store timestamps as UTC RFC 3339 text and hashes as lowercase SHA-256 hex. JSON used for hashes has one versioned canonical serializer; [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) is the first implementation's canonicalization rule. D1 can represent larger integer sequences, but its export documentation warns about JavaScript number precision, so the JSON API serializes sequence values as decimal strings. [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

### Source and identity records

`webhook_deliveries`

- `github_delivery_id` primary key; GitHub documents `X-GitHub-Delivery` as a globally unique delivery GUID.
- `event_name`, `action`, `hook_installation_target_id`, `installation_id`, `repository_id`.
- `payload_sha256`, `received_at`, `signature_verified_at`.
- No webhook secret or `X-Hub-Signature-256` value.

GitHub's payload supplies stable repository and sender identifiers and its delivery headers supply the event GUID. Signature validation proves origin and integrity before Ornn accepts the payload. [GitHub webhook headers and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads#delivery-headers), [validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

`invocations`

- `invocation_id` primary key, `github_delivery_id` unique foreign key.
- GitHub `installation_id`, `repository_id`, repository full name at receipt, issue or pull-request node/numeric ID, invoking comment node/numeric ID, sender numeric ID and login at receipt.
- `initial_source_snapshot_json`: only the exact bounded fields admitted to the first routing attempt: issue title/body and invoking comment. Do not store the entire webhook envelope.
- `initial_source_snapshot_sha256`, `authorization_policy_version`, `authorized_principal_id`, `accepted_at`.
- If a valid GitHub delivery is rejected before Invocation admission, keep the delivery plus an `invocation.rejected` event in the delivery stream; do not manufacture an Invocation.

`invocation_inputs`

- `input_id`, `invocation_id`, `github_delivery_id`, monotonically increasing `ordinal`, kind (`initial` or `clarification_reply`), GitHub comment node/numeric ID, authenticated sender ID, accepted content JSON and SHA-256, and `accepted_at`.
- Unique `(invocation_id, ordinal)`, `github_delivery_id`, and GitHub comment identity. This append-only record preserves every accepted clarification reply without mutating the initial Invocation snapshot.

`jobs`

- `job_id` primary key, `invocation_id` foreign key, `attempt_number`, optional `replaces_job_id`, with a unique `(invocation_id, attempt_number)` constraint.
- Exact `flow_id`, `flow_version`, `resolved_flow_config_json` and hash.
- Exact repository commit SHA, work-order hash, resolved capability-policy version.
- Resolved agent engine/version, model/provider/model ID and context configuration; sandbox driver/version, image digest, and resource-policy hash.
- `created_at`. Execution outcome and cleanup status are not mutable columns on this authoritative row; they are events and projections.

`job_leases`

- `lease_id` primary key, `job_id`, `runner_id`, monotonically increasing `generation`, issued/initial-expiry timestamps, capacity-reservation ID, and signed-grant fingerprint.
- Unique `(job_id, generation)` and `(runner_id, capacity_reservation_id, generation)` constraints.
- Renewals, expiry, revocation, release, and changed expiry are events. The signed grant itself and transport credential are not stored.

`capability_grants`

- `grant_id`, `job_id`, capability name/version, concrete provider/version/location, policy version, limits JSON and hash.
- `origin`: `flow_default`, `authorized_invoker_override`, or later `operator_runtime_approval`; include the authorizing Invocation/reply ID when applicable.
- `granted_at`. Revocation and limit changes require new events or a superseding grant, never an in-place rewrite of the original authority.

### Event ledger

`domain_events` is the reconstructable history. Every row contains:

- `event_seq INTEGER PRIMARY KEY AUTOINCREMENT` for a database-wide recorded order; expose it as a decimal string.
- `event_id` unique opaque text.
- `stream_kind` (`delivery`, `invocation`, or `job`), `stream_id`, and `stream_revision`; unique `(stream_kind, stream_id, stream_revision)` supplies optimistic concurrency.
- `event_type` and `event_schema_version`.
- Nullable indexed `invocation_id`, `job_id`, `lease_id`, `ornn_message_id`, and `artifact_id` correlation fields.
- `actor_kind` and `actor_id`. The control plane derives these from authenticated context; it never trusts caller-supplied actor fields.
- `producer_kind`, `producer_instance_id`, and `producer_event_id`; unique `(producer_kind, producer_instance_id, producer_event_id)` is the durable idempotency key.
- `occurred_at` from the source clock when known and control-plane `recorded_at`. Ordering and deadlines use `recorded_at`/`event_seq`; a Runner clock cannot change authority.
- `causation_event_id`, `correlation_id`, optional trace ID, canonical `payload_json`, and `payload_sha256`.
- For Runner events, the server-derived lease generation and Runner identity.

Payloads are versioned discriminated unions, not arbitrary log objects. A first-version event payload is limited to 32 KiB. Raw prompts, repository text, complete tool arguments/output, credentials, webhook signatures, and environment dumps do not belong in events.

### Ornn messages and revisions

`ornn_messages`

- `ornn_message_id` (`om_...`) primary key, message kind, owning Invocation, optional Job and interaction, GitHub repository/issue identity, and `created_at`.
- The ID is public correlation data only.

`ornn_message_revisions`

- `ornn_message_id`, integer `revision`, structured content JSON, rendered Markdown, renderer version, content hash, reason, and `prepared_at`.
- Unique `(ornn_message_id, revision)`. Revisions append; editing a GitHub progress comment never overwrites the prior D1 revision.
- GitHub comment ID/URL, attempted revision, provider request ID, and success/failure live in `message.publication_*` events because they become known after the external effect.

`ornn_message_relations`

- `ornn_message_id`, `relation_kind`, `target_id`, and stable `ordinal`.
- Allowed targets are only `invocation`, `job`, `interaction`, `artifact`, and `message`.
- Unique `(ornn_message_id, relation_kind, target_id)`. This bounded relation set is what message-ID resolution returns; it is not a general graph or search index.

### Analysis artifact and R2 object metadata

`analysis_artifacts`

- `artifact_id`, `job_id`, artifact schema version, terminal result kind (`questions`, `plan`, or `blocked`), `created_at`, optional `supersedes_artifact_id`.
- Exact repository commit SHA, Flow/version/config hash, engine/model/version, selected strategy, alternatives, affected code/contracts, risks, cleared concerns, safety claims and proof status, checks still required, operator questions or blocker, and next non-cheap investigation where applicable.
- Canonical structured payload JSON and SHA-256. Limit the first structured artifact to 512 KiB so it remains authoritative in D1. Large evidence is represented by typed object references, not by truncating the artifact.
- The linked final Ornn message ID and renderer version.

`artifact_objects`

- `object_id`, `artifact_id` or `job_id`, immutable R2 key, object kind, media type, byte length, SHA-256, created time, retention class, and calculated expiry time.
- Unique R2 key and unique `(owner_id, object_kind, sha256)`. D1 reserves the identity before upload; R2 is never asked to arbitrate uniqueness.
- Upload, verification, expiry, and deletion are events. Deletion never removes this metadata until a later manual D1 purge.

### Rebuildable projections

The implementation may keep `invocation_summary`, `job_summary`, `current_lease`, `message_summary`, and `artifact_summary` tables. They contain current routing outcome, state, pending interaction, execution outcome, cleanup status, latest message revision, and latest object state. Each row includes `last_event_revision` and `projection_version`.

These tables are caches and concurrency guards. A projection can be deleted and rebuilt from core records plus `domain_events`. No inspection response may claim a state for which the corresponding event is absent.

## Append, concurrency, and idempotency rules

1. Verify authentication and policy before opening a domain operation. For GitHub, validate `X-Hub-Signature-256` against the unmodified body before admitting the delivery. Never persist the signature.
2. Canonicalize the accepted request/event, calculate its SHA-256, and look up the producer idempotency tuple. An existing tuple with the same hash returns the original result. The same tuple with a different hash is a `409 idempotency_conflict` and appends nothing.
3. Read the current stream revision, validate the requested transition, and attempt the next revision. A competing writer loses the unique `(stream_kind, stream_id, stream_revision)` constraint, rereads, and re-evaluates policy. It does not blindly retry the stale transition.
4. Insert immutable fact rows, append their events, and update projections in one D1 `batch()` whenever all effects are internal to D1. A failed statement rolls back the batch.
5. For an external effect, first append a durable intent with a stable effect key, then call the provider, then append `succeeded`, `failed_no_effect`, or `failed_effect_unknown`. An unknown effect is reconciled through the provider before retry. This matches the existing SandboxDriver effect-certainty rule.
6. Never update or delete an event, message revision, resolved grant, artifact payload, or source snapshot. Corrections append a new event/revision and carry `supersedes_event_id` or `supersedes_artifact_id` where relevant.
7. Safe infrastructure retries stay in one Job and reuse the operation/effect key. Re-executing the agent creates a new linked Job and new event stream.
8. The event write succeeds before telemetry emission. Telemetry export runs outside the authoritative batch; its failure is ignored by the Job and may only produce a bounded local diagnostic.

The public read API uses a D1 Session starting at `first-primary`, or a client-supplied D1 bookmark returned by a previous response. Cloudflare documents that `first-primary` starts from the latest primary state and that bookmarks give sequential consistency across sessions. This prevents the operator from seeing an older projection immediately after an accepted write if read replication is later enabled. [D1 read replication and Sessions](https://developers.cloudflare.com/d1/best-practices/read-replication/)

## Minimum event catalog

This is the minimum durable vocabulary. Provider details belong in versioned payload fields, not new event names.

| Area | Required event types | Minimum payload facts |
| --- | --- | --- |
| Delivery and Invocation | `delivery.accepted`, `invocation.authorized`, `invocation.rejected`, `clarification.reply_accepted` | GitHub delivery/source IDs and hashes, authenticated actor, policy version, rejection reason or reply/message anchor |
| Routing | `routing.started`, `routing.flow_selected`, `routing.clarification_required`, `routing.failed` | Admitted input IDs/ordinals and combined hash, router provider/model/version, prompt-template/schema/catalog hashes, candidate Flow versions, parsed outcome and overrides, provider request ID, tokens/cost/quota when reported, failure code; raw provider output only by hash/R2 diagnostic |
| Job | `job.created`, `job.execution_started`, `job.paused`, `job.resumed` | Resolved Flow/config/work-order hashes, pinned commit, parent/replaced Job or artifact, pause reason and interaction ID |
| Lease | `lease.offered`, `lease.accepted`, `lease.renewed`, `lease.expired`, `lease.revoked`, `lease.released` | Runner, generation, expiry, capacity reservation, grant fingerprint, reason |
| Capability authority | `capability.granted`, `capability.revoked`, `capability.denied`, `capability.limit_reached` | Grant/policy/limit IDs and hashes, authority source, denial or limit dimension |
| Capability use | `capability.use_started`, `capability.use_succeeded`, `capability.use_failed` | Use/operation ID, grant, provider/version, sanitized operation/target class, input/output hashes, timing, effect certainty, error code, model/tool usage, provider quota and billed cost when reported. Source URLs needed as analysis evidence belong in the structured artifact; URLs with secret query values are never telemetry attributes. |
| Ornn message | `message.created`, `message.revision_prepared`, `message.publication_started`, `message.published`, `message.publication_failed` | Message/revision/hash, relation IDs, stable publication effect key, GitHub comment ID/URL, provider request ID, effect certainty |
| Analysis artifact | `analysis_artifact.created`, `analysis_artifact.object_attached`, `analysis_artifact.linked_to_message` | Artifact/schema/payload hash, result kind, pinned provenance, object IDs/hashes, message ID |
| Cancellation | `cancellation.requested`, `cancellation.accepted`, `cancellation.rejected`, `cancellation.runner_observed`, `cancellation.effect_fence_enabled` | Authenticated requester, source message/invocation, idempotency key, decision/policy version, observed lease/generation, last allowed effect sequence |
| Execution | `execution.succeeded`, `execution.failed`, `execution.cancelled` | Exactly one outcome, terminal reason/error code, partial/final artifact IDs, duration and limit interruption, aggregate usage/cost when reported |
| Cleanup | `cleanup.started`, `cleanup.attempt_failed`, `cleanup.quarantined`, `cleanup.retry_scheduled`, `cleanup.verified` | Sandbox identity/spec fingerprint, attempt/operation ID, observed provider state, stable error/effect certainty, retry time, verification evidence, capacity reservation state |

Execution and cleanup are independent streams of truth as required by [ADR 0003](../adr/0003-track-execution-and-cleanup-independently.md). `execution.succeeded` can coexist with `cleanup.attempt_failed`; only `cleanup.verified` releases the capacity reservation. The concrete teardown evidence and retry schedule come from the existing [Analyze Flow sandbox failure and cleanup contract](./analyze-flow-sandbox-failure-and-cleanup.md).

## Authenticated operator read API

The first machine clients are the operator's agents, so the smallest useful authentication is one 256-bit random bearer token stored as an encrypted Worker secret and in each operator-controlled client's local secret store. It maps to the single stable principal `operator:bjesuiter` with only `audit:read`. Compare its fixed-size digest with `crypto.subtle.timingSafeEqual`; never log it or store it in D1. Cloudflare documents encrypted Worker secret bindings and provides a timing-safe comparison API. [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [timing-safe comparison](https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/)

This token is an adapter-level v1 credential, not a domain assumption. A later OAuth session or Cloudflare Access integration must resolve to the same `OperatorPrincipal` and authorization check. Rotation may accept current and next credential IDs briefly, but never returns either token through the API.

Every route authenticates before looking up an ID, returns `Cache-Control: no-store`, validates typed parameters, and emits versioned JSON. There is no SQL endpoint and no direct D1 REST credential for clients; Cloudflare likewise recommends a Worker API when external callers need customized D1 access control. [D1 proxy API guidance](https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/)

| Endpoint | Response |
| --- | --- |
| `GET /api/v1/invocations/{invocationId}` | Accepted source provenance, authorization, routing outcome/attempts, clarification state, related Job/message IDs |
| `GET /api/v1/jobs/{jobId}` | Resolved provenance/configuration, current lease summary, grants, execution outcome, cleanup status, usage/cost totals, message and artifact metadata |
| `GET /api/v1/streams/{kind}/{id}/events?after={revision}&limit={n}` | Ordered immutable events for one `invocation` or `job` stream; default 100, maximum 250; next revision cursor and D1 bookmark |
| `GET /api/v1/messages/{ornnMessageId}` | Message identity, all revisions, latest publication result, and deterministic related Invocation, Job, interaction, artifact, and message summaries in relation order |
| `GET /api/v1/artifacts/{artifactId}` | Full structured analysis artifact plus immutable object metadata and expiry/deletion state |
| `GET /api/v1/artifacts/{artifactId}/objects/{objectId}` | Authenticated streaming read of a still-retained R2 object after D1 ownership and hash metadata are checked |

There is deliberately no initial endpoint to list all Jobs, search text, aggregate usage, query arbitrary relations, or expose raw provider logs. Message-ID resolution is the discovery path: an authenticated client that knows `om_...` receives the exact bounded relation set and can follow returned IDs. Without authentication the same public ID yields only `401`; it grants no read capability.

When an Invocation says “use the artifact from the first Job” relative to an Ornn message, the control plane obtains candidate objects from these exact D1 relations and only then lets the router interpret the relative phrase. The model never searches D1 or expands authorization.

## Runner write and resolution boundary

Runner transport authentication and Job authorization are separate checks. The outbound HTTPS transport must establish a registered `runner_id`. Each accepted lease also carries a short-lived control-plane-signed `RunnerLeaseGrant` with:

- `grant_id`, `runner_id`, `job_id`, `lease_id`, and `generation`;
- issued, not-before, and expiry timestamps;
- scopes limited to `lease:heartbeat`, `events:append`, and `message:resolve-related`;
- protocol/schema version and a random token ID.

Store only its fingerprint in D1. The format and enrollment credential remain inside the Runner transport adapter. Cloudflare Workers can generate random values and sign or verify HMAC/Ed25519 data through Web Crypto, so this contract needs no additional Cloudflare service. [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)

The Runner surface is limited to:

- `POST /runner/v1/leases/{leaseId}/heartbeat`;
- `POST /runner/v1/leases/{leaseId}/events` with at most 20 events and 256 KiB total body;
- `GET /runner/v1/leases/{leaseId}/messages/{ornnMessageId}` only for a message already related to that lease's Job or Invocation.

For every call, the control plane verifies transport identity, signature, expiry, D1 current-lease projection, generation, revocation, and route lease ID. The Job ID and actor are derived from the lease; request JSON cannot override them. The event append uses each Runner's `(lease_id, producer_event_id)` and payload hash for idempotency.

The Runner may emit only `lease.accepted`, heartbeats/observations, allowed capability-use events, message revision proposals, execution observations, cancellation observations, artifact-object observations, and cleanup observations. The control plane owns authorization, routing, grant issuance, cancellation acceptance, final outcome acceptance, publication truth, and `cleanup.verified`; it translates validated Runner observations into those authoritative events.

After cancellation acceptance or a terminal execution event, the same lease may report stop, partial-artifact, and cleanup observations while its capacity reservation remains held. It may not start another capability use or external effect. A stale, expired, revoked, wrong-Runner, or wrong-generation grant returns `403 lease_not_current` and appends nothing.

There is no Runner route for `/jobs`, event reads, arbitrary artifact reads, or arbitrary message resolution. Lease polling may return only work assigned to the authenticated Runner. Related-message resolution applies the D1 relation filter before returning content, so possession of another public `om_...` ID reveals nothing.

First-version lease defaults are a 90-second lease, heartbeat every 30 seconds, and renewal before 60 seconds. Missing two expected heartbeats makes the lease eligible for expiry; it does not release Runner capacity or prove cleanup.

## Telemetry projection

Emit spans/log events after D1 acceptance with these bounded attributes where applicable:

- `ornn.invocation.id`, `ornn.job.id`, `ornn.lease.id`, `ornn.runner.id`;
- `ornn.flow.id`, `ornn.flow.version`, `ornn.capability.name`;
- `ornn.event.type`, execution outcome, cleanup status, stable error code;
- provider/engine/model/sandbox adapter names and versions;
- duration, token/tool counts, provider quota, and billed-cost measurements when reported.

Use low-cardinality event names and the application-specific `ornn.*` namespace, consistent with OpenTelemetry's naming and event guidance. OpenTelemetry log records can carry source and observed timestamps plus trace/span correlation, but those fields do not change D1's authoritative order. [OpenTelemetry naming](https://opentelemetry.io/docs/specs/semconv/general/naming/), [event conventions](https://opentelemetry.io/docs/specs/semconv/general/events/), [log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)

Never emit credentials, authorization headers, webhook signatures, raw work-order/repository/fetched text, full URLs with query strings, tool arguments/results, or message/artifact bodies by default. OpenTelemetry explicitly recommends data minimization for credentials, session tokens, PII, and user behavior. [OpenTelemetry sensitive-data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/)

Cloudflare's OTLP export currently covers traces and logs, not metrics, and remains beta. Cloudflare also does not yet propagate trace IDs to external services. Stable Ornn IDs are therefore the cross-component join keys; do not invent a false parent/child trace relationship. [Workers OTLP export](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/), [Workers trace limitations](https://developers.cloudflare.com/workers/observability/traces/known-limitations/)

The v1 Worker uses configurable Workers Observability with head sampling `1.0` at the expected personal volume. This improves diagnostics but does not weaken the rule that any log, trace, or export may be missing and export failure cannot affect Job progress.

## Retention and deletion

### D1

- Keep authoritative records and events until an explicit manual operator purge. There is no automatic Job/event TTL in v1.
- Never purge an Invocation with an active/pending interaction, a nonterminal Job, an unverified cleanup, an unreleased capacity reservation, or an R2 deletion still marked unknown.
- The first operator API is read-only. Purge is an offline/admin command with an explicit repository or Invocation scope, dry run, typed confirmation, and its own authenticated operator identity.
- Purge deletes content and relation rows transactionally, but retains a minimal `purge_tombstones` row containing purged Invocation/Job/message/artifact IDs, deletion time, operator credential ID, reason, and pre-purge manifest hash. IDs are never reused. An authenticated lookup of a purged `om_...` returns `410 gone`; unauthenticated callers still receive `401`.
- Run an SQL export and recovery drill before the first production migration and before bulk purge. D1 supports SQL export, but an export blocks other database requests, so schedule it as maintenance rather than a request-path feature. [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

D1 Time Travel is disaster recovery, not application retention or immediate erasure. It is always on and can restore up to 30 days on Workers Paid or seven days on Free. A manual purge can therefore remain recoverable inside Cloudflare for that window; Ornn must state this in any future deletion UI. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

### R2 and telemetry

- Put sanitized diagnostics under a dedicated `diagnostics/` prefix with a 30-day lifecycle rule. Record the calculated expiry in D1.
- Lifecycle deletion is a backstop, not exact audit evidence: Cloudflare says expired objects are typically removed within 24 hours of their expiration value. A reaper verifies absence and appends `artifact_object.deleted`; D1 keeps the key, hash, size, provenance, expiry, and deletion result. [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- The structured analysis artifact remains in D1. If an operator explicitly promotes immutable evidence to durable artifact storage, give it a different retention class and D1 event; do not silently exempt diagnostics from expiry.
- Workers Observability follows the platform's current retention (seven days on Paid, three on Free). Any later OTLP backend chooses its own diagnostic retention. Neither changes D1 or R2 policy. [Workers Logs retention](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#limits)

## First-version defaults

| Setting | Default |
| --- | --- |
| Authority | One D1 database; Ornn Drizzle schema and checked-in SQLite migrations |
| Event concurrency | Per-stream integer revision plus unique producer idempotency tuple |
| Event payload | 32 KiB maximum, canonical JSON, SHA-256 |
| Structured analysis artifact | 512 KiB maximum in D1; typed evidence references beyond it |
| Operator authentication | One 256-bit bearer secret mapped to `operator:bjesuiter`, `audit:read` only |
| Operator event page | 100 default, 250 maximum, revision cursor plus D1 bookmark |
| Read consistency | `first-primary` unless continuing a returned bookmark |
| Runner lease | 90 seconds; 30-second heartbeat; renew by 60 seconds |
| Runner append batch | 20 events, 256 KiB request maximum |
| R2 diagnostics | Immutable key, SHA-256 verified, expire after 30 days |
| D1 retention | Until explicit manual purge; active/unverified records are ineligible |
| Workers Observability | Configurable, initial head sampling `1.0`, current platform retention |

## Required contract tests

1. **Webhook admission and deduplication:** a repeated GitHub delivery produces one delivery and one Invocation; a repeated delivery ID with different body hash is rejected. Invalid signatures create no Invocation and signatures never appear in storage or telemetry.
2. **Atomic append:** inject a failure into every statement of fact/event/projection batches and prove no partial authoritative state commits.
3. **Optimistic concurrency:** race cancellation, completion, and Runner event append at one stream revision. Exactly one transition wins; losers reread and cannot create two execution outcomes.
4. **Idempotent replay:** replay every command/event with the same producer key and hash and receive the original IDs; change the payload and receive `409` without mutation.
5. **Projection rebuild:** delete every projection, replay D1 records/events, and reproduce the same routing, Job, lease, outcome, cleanup, message, and artifact summaries byte-for-byte.
6. **Routing provenance:** reconstruct the exact admitted router input, prompt/schema/catalog versions, selected Flow/overrides or clarification, provider/model, usage, and cost without consulting telemetry.
7. **Lease authorization matrix:** reject wrong Runner, wrong lease, stale generation, expired/revoked grant, invalid signature, disallowed event type, oversized batch, caller-supplied Job/actor override, and capability start after cancellation/terminal outcome.
8. **Runner isolation:** prove there is no list endpoint and that another Job's event, artifact, or `om_...` ID cannot be read or appended through a valid current lease.
9. **Message history:** prepare and publish multiple revisions, retry a timed-out GitHub edit, preserve every revision and effect result, and resolve the public message ID only after operator/lease authorization.
10. **Artifact integrity:** reserve D1 metadata, upload immutable bytes, verify SHA-256/length on read, reject key reuse with different bytes, and keep metadata after lifecycle deletion.
11. **Cancellation reconstruction:** recover requester, authority, acceptance/fence order, Runner observation, partial effects, execution outcome, and cleanup from D1 only.
12. **Independent cleanup:** cover every valid execution outcome with `pending`, `failed`, and `verified` cleanup; prove capacity releases only after `cleanup.verified`.
13. **Retention:** expire a diagnostic at 30 days, tolerate lifecycle delay, verify absence before marking deletion, prevent purge of active/unverified Jobs, and return an authenticated `410` from retained message tombstones.
14. **Telemetry loss and redaction:** make logging and OTLP export throw, sample all telemetry away, and prove Job behavior and inspection are unchanged. Scan telemetry fixtures for secrets, signatures, raw work-order text, tool payloads, and query-bearing URLs.
15. **Read consistency and pagination:** read immediately after append using `first-primary`/bookmark, paginate while new events append, and observe each stream revision exactly once in order.
16. **Portability:** run the repository/event contract against local D1 and a second SQLite driver, plus a small deployed-D1 smoke test for `batch()` rollback and Sessions behavior; run the immutable object contract against R2 and Garage. Provider-native IDs may differ, while Ornn records and API responses remain equivalent.
17. **Recovery:** export/import D1 into a clean test database, verify all hashes and foreign keys, then rebuild projections. Test that a TanStack workflow journal can be lost while the authoritative completed Job remains inspectable.

These tests are the acceptance boundary for the implementation route. A dashboard, free-form audit query language, analytics warehouse, organization-wide identity system, and long-term telemetry backend remain outside the first Analyze Flow.
