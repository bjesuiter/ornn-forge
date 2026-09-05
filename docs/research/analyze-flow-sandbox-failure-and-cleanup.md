# Analyze Flow sandbox failure and cleanup

Status: research complete

Last verified: 2026-09-05

Issue: [#19](https://github.com/bjesuiter/ornn-forge/issues/19)

## Decision

The first Docker Runner can meet the Analyze Flow's failure and cleanup requirements without another service. It needs a stricter adapter around TanStack and Docker, a small durable recovery ledger, and startup reconciliation before it advertises capacity.

Use seven stable `SandboxError` codes: `rejected`, `not_found`, `conflict`, `resource_exhausted`, `unavailable`, `deadline_exceeded`, and `internal`. Every error also states whether the failed operation definitely had no effect or may have had an effect. That second field is what prevents an `exec` or uncertain `create` from being retried blindly.

Use one fresh container for one Job. Give it a deterministic name and Ornn ownership labels, set its Docker restart policy to `no`, and do not use automatic removal. Cancellation stops the whole container, not only the current Docker exec process. Destruction succeeds only after the Runner can reach Docker and prove that the exact container and its recorded anonymous volumes are absent.

Keep `execution outcome` and `cleanup status` independent, as ADR 0003 requires. A cleanup failure quarantines the sandbox and retains its capacity reservation. The reaper keeps retrying. There is no retry limit after which Ornn declares a possibly live sandbox gone.

No operator decision is needed for this contract.

## Evidence that shapes the contract

### TanStack is useful below the Ornn contract, but cannot define it

The source inspected here is TanStack commit `9b0db21`, whose manifests report `@tanstack/ai-sandbox` 0.5.6 and `@tanstack/ai-sandbox-docker` 0.3.2 ([core manifest](https://github.com/TanStack/ai/blob/9b0db21752785e333916aec83c5467d53c3c33f6/packages/ai-sandbox/package.json), [Docker manifest](https://github.com/TanStack/ai/blob/9b0db21752785e333916aec83c5467d53c3c33f6/packages/ai-sandbox-docker/package.json)). Pin the versions selected by implementation and rerun the same contract tests on every upgrade.

The current TanStack sandbox contract has process execution, file operations, process killing, and destruction. It has no portable inspection or owned-resource discovery operation. Its `SandboxCreateInput.id` is only a request that providers may ignore ([TanStack contracts at `9b0db21`](https://github.com/TanStack/ai/blob/9b0db21752785e333916aec83c5467d53c3c33f6/packages/ai-sandbox/src/contracts.ts#L192-L236)). The Docker provider does ignore that ID and lets Docker mint one. Its configuration also has no fields for Ornn labels, CPU, memory, PID limits, read-only root filesystems, init, or restart policy. It enables `host.docker.internal` by default ([Docker provider source](https://github.com/TanStack/ai/blob/9b0db21752785e333916aec83c5467d53c3c33f6/packages/ai-sandbox-docker/src/provider.ts#L14-L39), [container creation](https://github.com/TanStack/ai/blob/9b0db21752785e333916aec83c5467d53c3c33f6/packages/ai-sandbox-docker/src/provider.ts#L90-L140)). The Ornn adapter therefore needs direct Docker create, inspect, list, stop, and remove calls, or an Ornn-specific TanStack provider that makes those calls.

Current TanStack Docker process killing is better than the older implementation evaluated by the foundation report. It records the in-container PID, signals the process group, escalates to `SIGKILL`, and checks `kill -0`. Destroying the client stream alone only detaches it and leaves the command running ([PID and group-kill implementation](https://github.com/TanStack/ai/blob/9b0db21752785e333916aec83c5467d53c3c33f6/packages/ai-sandbox-docker/src/handle.ts#L144-L235)). The provider now declares `killableProcesses: true` based on a live conformance test ([TanStack provider documentation](https://tanstack.com/ai/latest/docs/sandbox/providers#killableprocesses-across-the-bundled-providers)).

That process-kill method is not strong enough to settle Job cancellation. It deliberately never rejects; it reports a refused kill through a logger. The handle catches stop errors during destruction, and the provider-level `destroy(id)` suppresses both stop and remove errors as if the resource were already absent ([spawn kill behavior](https://github.com/TanStack/ai/blob/9b0db21752785e333916aec83c5467d53c3c33f6/packages/ai-sandbox-docker/src/handle.ts#L756-L786), [handle destruction](https://github.com/TanStack/ai/blob/9b0db21752785e333916aec83c5467d53c3c33f6/packages/ai-sandbox-docker/src/handle.ts#L816-L825), [provider destruction](https://github.com/TanStack/ai/blob/9b0db21752785e333916aec83c5467d53c3c33f6/packages/ai-sandbox-docker/src/provider.ts#L177-L191)). Ornn must translate warnings into failures and perform its own absence check.

TanStack itself destroys the entire sandbox on cancellation when process killing is unavailable. Its documentation is explicit that closing a stream is not cancellation and that a provider with no verified signal path can stop work only by destroying the sandbox ([takeover and cancellation](https://tanstack.com/ai/latest/docs/sandbox/takeover#what-cancel-means-on-a-provider-that-cannot-kill)). Ornn should use that stronger rule for the first one-Job-per-container Runner even though the current Docker provider can kill an individual exec.

### Docker has the recovery operations the adapter needs

Docker gives every container an isolated process tree. `--init` adds a small PID 1 that forwards signals and reaps children ([running containers](https://docs.docker.com/engine/containers/run/), [multiple processes](https://docs.docker.com/engine/containers/multi-service_container/)). `docker stop` sends the configured stop signal, normally `SIGTERM`, then sends `SIGKILL` after the timeout ([stop reference](https://docs.docker.com/reference/cli/docker/container/stop/)). Forced removal sends `SIGKILL` and removes the container, and `--volumes` removes its anonymous volumes ([remove reference](https://docs.docker.com/reference/cli/docker/container/rm/)).

Docker labels can record Ornn ownership and can be inspected and used as list filters ([Docker object labels](https://docs.docker.com/engine/manage-resources/labels/)). The all-containers list includes stopped and `dead` containers. A `dead` container is still present and may only be removed, so it must never count as verified cleanup ([container list states](https://docs.docker.com/reference/cli/docker/container/ls/#status)).

Docker's default restart policy is `no`. That is the required policy for Job containers. A daemon restart must not resurrect work after Ornn has cancelled it or lost its engine session ([restart policies](https://docs.docker.com/reference/cli/docker/container/run/#restart-policies)). Automatic removal is intentionally unsuitable here because the Runner needs the stopped container long enough to collect partial artifacts and needs an inspectable record after a crash.

### systemd can restart the Runner, not the Docker sandboxes

systemd recommends `Restart=on-failure` for long-running services. `RestartSec` controls the delay, and unit start limits stop a crash loop after a configured number of starts ([service restart settings](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#Restart=), [unit start limits](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#StartLimitIntervalSec=interval)). `KillMode=control-group`, the default, sends termination to every process in the service cgroup and escalates after `TimeoutStopSec` ([systemd kill behavior](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html#KillMode=), [stop timeout](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#TimeoutStopSec=)). Docker container processes belong to Docker's cgroups, not the Runner service cgroup, so Runner startup reconciliation remains necessary.

`StateDirectory=` creates persistent service-owned state under `/var/lib` for a system unit and does not remove it when the service stops ([systemd execution directories](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#RuntimeDirectory=)). This is enough for a small local recovery ledger. The control plane remains authoritative for Job state.

## Stable v1 `SandboxDriver` contract

The public contract should use Ornn types only. TanStack handles, Docker IDs, status strings, and errors stay in the adapter.

```ts
type SandboxErrorCode =
  | 'rejected'
  | 'not_found'
  | 'conflict'
  | 'resource_exhausted'
  | 'unavailable'
  | 'deadline_exceeded'
  | 'internal'

type OperationEffect = 'none' | 'unknown'

interface SandboxError extends Error {
  code: SandboxErrorCode
  operation:
    | 'create'
    | 'discover'
    | 'inspect'
    | 'exec'
    | 'read'
    | 'write'
    | 'collect'
    | 'terminate'
    | 'destroy'
  effect: OperationEffect
  retryAfterMs?: number
  diagnosticRef: string
}

interface SandboxLease {
  sandboxId: string
  generation: number
  runnerId: string
  providerRef: string
  specFingerprint: string
  createdAt: string
  expiresAt: string
}

type SandboxObservation =
  | { state: 'absent'; observedAt: string }
  | {
      state: 'present'
      phase: 'starting' | 'ready' | 'stopped' | 'removing' | 'faulted'
      processes: 'running' | 'stopped' | 'unknown'
      specFingerprint: string
      observedAt: string
    }

interface SandboxDriver {
  create(spec: SandboxSpec, signal: AbortSignal): Promise<SandboxLease>
  discover(scope: { runnerId: string }): Promise<readonly SandboxLease[]>
  inspect(lease: SandboxLease): Promise<SandboxObservation>
  exec(
    lease: SandboxLease,
    request: ExecRequest,
    signal: AbortSignal,
  ): Promise<ExecResult>
  readFile(lease: SandboxLease, path: RepoPath): Promise<Uint8Array>
  writeFile(
    lease: SandboxLease,
    path: RepoPath,
    data: Uint8Array,
  ): Promise<void>
  collectArtifacts(
    lease: SandboxLease,
    spec: ArtifactSpec,
  ): Promise<ArtifactManifest>
  terminate(
    lease: SandboxLease,
    reason: TerminationReason,
  ): Promise<void>
  destroy(lease: SandboxLease): Promise<void>
}
```

`providerRef` is opaque outside the adapter. The Runner persists it so a new process can inspect and destroy the same resource. `generation` fences an old Runner process or duplicate lease holder. Every mutating operation rejects a stale generation with `conflict`.

`discover` is narrow. It returns only resources with valid Ornn ownership metadata for the supplied Runner. It exists because a Runner may crash after Docker creates a container but before `create` returns or the provider reference reaches the control plane. It is not a general provider inventory API.

`terminate` is idempotent and applies to the whole sandbox process tree. It returns only when `inspect` can show `processes: 'stopped'` or `state: 'absent'`. `destroy` is also idempotent. It returns only after the adapter's absence verification succeeds. A provider's accepted stop or remove response is not success by itself.

The adapter must not turn all provider exceptions into `not_found`. It may return `not_found` only for an exact provider response that means the addressed resource does not exist. Authentication failures, socket failures, timeouts, and server errors map elsewhere.

### Error meanings and caller behavior

| Code | Stable meaning | Default caller behavior |
| --- | --- | --- |
| `rejected` | The request cannot run because its spec, required capability, policy, permission, or Runner configuration is invalid. | Do not retry. Fail the attempt or mark the Runner unschedulable. Keep provider detail in the diagnostic record. |
| `not_found` | The adapter positively established that the addressed resource is absent. | Treat as success only for `inspect`, `terminate`, and `destroy`. For other operations, fail as a stale lease. |
| `conflict` | The resource identity, generation, owner, spec fingerprint, or lifecycle state does not match the request. | Stop mutations, quarantine matching resources, and reconcile. Never adopt by provider ID alone. |
| `resource_exhausted` | A concrete provider or host limit prevented the operation. | Do not spin. Let scheduling wait for capacity or an operator correction. |
| `unavailable` | Docker or another provider cannot currently be reached. | Retry safe reads and teardown with backoff. Do not infer absence. |
| `deadline_exceeded` | The operation did not settle before its deadline. Its `effect` says whether work may have started. | Inspect or discover before any retry when `effect` is `unknown`. |
| `internal` | The adapter encountered an invariant violation or an unclassified provider response. | Record full diagnostics, reconcile, and quarantine any resource whose state is uncertain. No blind retry. |

`effect` is required on every error. `none` means retrying the same call cannot duplicate an effect. `unknown` means the caller must inspect or discover first. A command timeout always has `effect: 'unknown'` unless the adapter proves Docker rejected it before start.

Provider error text and native codes may be retained in a redacted diagnostic record. Flow code must branch only on the seven Ornn codes, operation, and effect.

## Docker identity and creation rules

Before Docker create, persist a capacity reservation and a local ledger entry in `provisioning`. The Docker container gets:

- a deterministic name derived from `runnerId`, `sandboxId`, and `generation`;
- labels for `managed=true`, `runnerId`, `jobId`, `attemptId`, `sandboxId`, `generation`, and `specFingerprint`;
- the digest-pinned image already checked by Runner readiness;
- `restart=no`, `init=true`, no automatic removal, and no named volume;
- the approved CPU, memory, PID, filesystem, user, capability, and network settings from `SandboxSpec`;
- no `host.docker.internal` mapping unless the resolved capability policy explicitly needs the Runner tool bridge.

The exact label names are adapter implementation details, but their values are part of the recovery record. Do not put prompts, repository URLs containing credentials, tokens, or other secrets in labels.

Create follows this algorithm:

1. List by deterministic identity and ownership labels.
2. If one container has the expected owner, generation, and spec fingerprint, inspect and adopt it. This settles a prior uncertain create.
3. If none exists, create by deterministic name.
4. If more than one exists, or any immutable label differs, return `conflict` and quarantine every candidate.
5. Persist the full Docker ID and captured anonymous-volume IDs before reporting the sandbox ready.

Docker name uniqueness closes the race between two create calls. A name conflict triggers discovery. It never triggers creation with a random replacement name.

Do not pull an image in a Job's create path. Runner readiness should resolve and cache the approved digest first. This keeps `create` within 30 seconds and prevents a registry outage from leaving a half-created Job.

## State transitions

The Runner keeps a durable sandbox lifecycle record separate from the Job's execution outcome and cleanup status.

| Sandbox lifecycle | Meaning | Capacity |
| --- | --- | --- |
| `provisioning` | Reservation and deterministic identity exist; create may or may not have reached Docker. | Held |
| `ready` | Exact container exists and passed spec and readiness inspection. | Held |
| `termination_requested` | No new exec, write, or capability call may start. | Held |
| `stopped` | Docker proves the container has no running workload. Partial artifact collection may run. | Held |
| `destruction_requested` | Removal has started or must be reconciled. | Held |
| `quarantined` | Identity or cleanup is uncertain, or bounded inline cleanup failed. | Held |
| `gone` | Docker was reachable and absence verification passed. | Released |

Normal transitions are:

```text
provisioning -> ready
provisioning -> termination_requested
ready -> termination_requested
termination_requested -> stopped
termination_requested -> gone
stopped -> destruction_requested -> gone
any non-gone state -> quarantined -> destruction_requested -> gone
```

`provisioning -> gone` is allowed when Docker positively shows that creation had no effect. `termination_requested -> gone` covers forced removal when graceful stopping fails. There is no transition from `quarantined` to `ready`; a quarantined sandbox is never reused by another Job.

`execution outcome` starts unset and becomes exactly one of `succeeded`, `failed`, or `cancelled`. Runner loss becomes `failed` with terminal reason `runner_lost`, unless a durable cancellation request was already accepted, in which case the outcome is `cancelled`. Cleanup begins as `pending` as soon as create might have had an effect. It becomes `verified` only at `gone`. It becomes `failed` when the inline cleanup budget expires or a non-retryable teardown error occurs. A reaper attempt may move `failed` back to `pending`, then to `verified` or `failed` again.

This preserves ADR 0003. A successful analysis artifact may be published with a visible cleanup warning, while the reservation stays held and the reaper continues. Publication policy does not change the cleanup state.

## Cancellation and process-tree termination

Cancellation order is fixed:

1. Persist the authorized cancellation intent and its event ID.
2. Fence new engine tools, sandbox mutations, capability calls, and publication claims.
3. Abort the engine session and wait up to 2 seconds for it to stop issuing calls.
4. Ask the active TanStack process handle to stop for fast feedback, but do not treat that result as Job-level termination.
5. Stop the whole Docker container with a 5-second `SIGTERM` grace period and forced `SIGKILL` escalation.
6. Inspect the container. If it is not provably stopped, force-remove it immediately and verify absence.
7. If stopped, spend at most 15 seconds collecting bounded partial artifacts and logs into private artifact storage. Then remove the container and verify absence.
8. Persist execution outcome `cancelled`. Persist cleanup as `verified` or `failed` independently.

Safety wins over partial artifact recovery. If step 5 cannot prove that processes stopped, skip artifact collection and force removal. If removal cannot be verified, publish no new external effect, mark cleanup `failed`, quarantine the sandbox, and keep its capacity reservation. The cancellation outcome remains `cancelled`, with a visible warning that work may still be running.

The same stop-and-escalate path applies to Job and command timeouts. A command timeout is not retried. Once its deadline expires, the Runner treats the sandbox as tainted and terminates the Job container because the timed-out command may have forked descendants or performed partial writes.

## Destruction and verification

For the first Docker Runner, teardown is:

1. Inspect the exact full container ID and validate all immutable Ornn labels against the lease.
2. Record anonymous volume IDs and final container state in the cleanup event.
3. Stop with a 5-second grace period. A confirmed already-stopped state is harmless.
4. Remove the exact container with force and anonymous-volume removal enabled.
5. Query Docker again. Success requires both an exact-container `not found` response and zero containers returned by the full ownership label set.
6. Verify that each anonymous volume captured in step 2 is absent.
7. Persist the verification time and evidence summary, then release capacity.

The Docker daemon must be reachable for steps 5 and 6. A socket error, permission error, request timeout, or generic provider failure leaves cleanup unverified. A `removing` or `dead` container is present. An empty in-memory handle, closed stream, stopped process, successful `remove` response, or missing local ledger entry proves nothing about deletion.

The v1 image and workspace must not use named volumes. If a later driver adds separately managed disks, networks, snapshots, or sidecars, each resource needs owned discovery and its own verified-absence rule before that driver can pass the contract suite.

## Timeouts and retries

These are initial personal-Runner defaults, not provider constants:

| Operation | Deadline | Retry rule |
| --- | ---: | --- |
| `discover`, `inspect` | 5 seconds | Up to 3 total attempts for `unavailable`, with 250 ms then 1 second delay. |
| `create` | 30 seconds | Up to 3 total attempts only when `effect: none`. With `effect: unknown`, discover first. |
| `readFile`, bounded artifact read | 30 seconds | Up to 3 total attempts for `unavailable` if no bytes were returned. |
| `writeFile`, `exec` | Flow/request deadline | No automatic retry. These calls may have partial effects. |
| `terminate` | 10 seconds | One graceful attempt, then force removal. |
| partial artifact collection after cancellation | 15 seconds | Best effort, no retry before termination safety. |
| inline destroy and verification | 60 seconds total | Attempts at about 0, 2, 6, and 14 seconds while time remains. |

Add 20 percent random jitter to retry delays. Re-check cancellation before every retry. `rejected` and `conflict` are not retried. `resource_exhausted` returns to scheduling rather than spinning inside the driver. `deadline_exceeded` and `internal` require reconciliation before another mutation.

If inline teardown does not verify cleanup within 60 seconds, set cleanup to `failed`, quarantine the sandbox, and finish reporting the execution outcome. The Runner reaper tries again after about 30 seconds, 1 minute, 2 minutes, 4 minutes, and 8 minutes, then every 15 minutes with jitter. It continues until verification succeeds or an operator repairs the record. A 24-hour age changes alert severity, not cleanup truth or capacity accounting.

These retries apply to infrastructure operations inside one Job. They never create a second agent execution. Re-executing the agent remains a new linked Job.

## Quarantine and capacity

A sandbox enters quarantine when any of these is true:

- create or destroy timed out and discovery cannot settle the effect;
- Docker is unreachable when termination or absence must be proven;
- immutable ownership labels, lease generation, or spec fingerprint differ;
- discovery finds duplicate containers for one sandbox identity;
- process-tree termination or forced removal cannot be verified;
- Docker reports `dead`, an unexpected restart, or another state the adapter cannot normalize safely;
- the adapter reports `internal` during a mutating operation.

Every discovered Ornn-managed container consumes one capacity slot. A normal Job reservation consumes one slot even if its container is stopped. Each duplicate or unowned-but-Ornn-managed container beyond a valid reservation adds one unit of capacity debt. Available capacity is never less than zero:

```text
available = max(0, configured capacity - active reservations - capacity debt)
```

The Runner must stop claiming Jobs when available capacity is zero. It must not release a reservation because execution ended, a process stopped, a lease expired, or a fixed number of cleanup retries elapsed. Only verified cleanup releases it.

A quarantined sandbox is frozen to new exec, write, capability, and publication operations. The reaper may inspect, collect already-approved diagnostics, stop, and destroy it. It may not resume the agent or assign the sandbox to another Job.

## Runner restart reconciliation

The Runner performs reconciliation before it reports ready or advertises capacity:

1. Open the local ledger from the systemd state directory.
2. Reach the control plane and fetch this Runner's active, terminal-but-unverified, and provisioning lease records. If the control plane is unavailable, advertise zero capacity and retry. Do not delete based only on the local cache.
3. Ask the driver to discover every Ornn-managed resource for this Runner, including stopped, removing, and dead containers.
4. Match records by `runnerId`, `sandboxId`, `generation`, full provider reference, and spec fingerprint.
5. For a durable cancellation, terminal Job, expired lease, or cleanup-pending record, run teardown.
6. For a Job that was executing when the Runner process died, record `failed/runner_lost`, preserve bounded partial artifacts if the container can first be stopped, and tear it down. The first slice does not reconstruct the lost in-memory Pi session or resume command streams.
7. If a record is unverified but both exact-ID inspection and ownership-label discovery prove absence, mark cleanup verified and release capacity.
8. If a container has valid Ornn ownership but no control-plane record, first confirm that the control plane is authoritative and reachable. Then treat it as an orphan, quarantine it, and reap it.
9. If labels are malformed, identities conflict, or multiple containers match, quarantine them and require operator inspection.

The Runner may not resume a stopped container merely because TanStack `resume` can do so. Resume is allowed only when durable Job state explicitly authorizes it and the engine session can be recovered. That recovery path is outside the first Analyze Flow.

The local ledger stores only recovery data: lease identity, provider reference, spec fingerprint, captured volume IDs, last observation, and pending operation ID. Write it atomically before and after provider mutations. It is not a second Job database.

## systemd defaults for `homeserv1`

Use these service settings as the v1 baseline:

```ini
[Unit]
Requires=docker.service
After=docker.service network-online.target
StartLimitIntervalSec=5min
StartLimitBurst=5

[Service]
Type=simple
Restart=on-failure
RestartSec=5s
TimeoutStopSec=45s
KillMode=control-group
SendSIGKILL=yes
StateDirectory=ornn-runner
StateDirectoryMode=0700
```

On `SIGTERM`, the Runner first stops claiming leases, persists its current operation markers, and asks active Jobs to cancel. The 45-second service timeout bounds that drain. If systemd kills the Runner, its next process reconciles Docker before accepting work. `KillMode=control-group` cleans up Runner child helpers, but does not substitute for Docker teardown.

Five failures in five minutes intentionally stop a crash loop. After repairing the cause, the operator uses `systemctl reset-failed ornn-runner` and starts the service. A stopped Runner advertises no capacity, but existing reservations and quarantined resources remain recorded in the control plane.

## Manual recovery

Manual recovery is deliberately narrow. Never use `docker container prune`, a broad label deletion, or a Docker daemon restart as the first response on a shared host.

1. Stop the Runner service so it cannot race the operator: `sudo systemctl stop ornn-runner`.
2. Capture `systemctl status ornn-runner`, recent Runner logs, and Docker daemon logs. Docker documents `journalctl -xu docker.service` for Linux daemon diagnostics ([Docker daemon logs](https://docs.docker.com/engine/daemon/logs/)).
3. List all containers with the Runner's exact ownership labels, with `--all` and `--no-trunc`. Do not omit stopped or dead containers.
4. Inspect each full container ID. Record its immutable labels, state, image digest, mounts, and full ID. Compare those values with the control-plane Job and lease record.
5. If identity is ambiguous or the control plane might still consider the Job active, leave the container stopped and repair the record first.
6. Once the exact resource is confirmed safe to remove, stop that one full ID with a 5-second timeout, then remove that one full ID with force and anonymous-volume removal.
7. Verify that exact-ID inspect reports not found, the full label query returns no match, and recorded anonymous volumes are absent.
8. Start the Runner. Startup reconciliation should mark cleanup verified and restore capacity. If systemd's start limit fired, run `sudo systemctl reset-failed ornn-runner` first.

If Docker cannot inspect the resource, do not mark cleanup verified. Repair Docker access or the daemon first. Restarting the Docker daemon may affect unrelated containers and requires a separate host-level decision.

## Required contract tests

The Docker adapter and a fake driver must pass the same state and error tests. The Docker-specific suite should cover at least:

- create succeeds but the response is lost; retry discovers exactly one container and does not duplicate it;
- create fails after Docker created the container; the lease remains recoverable from labels;
- deterministic-name conflict, stale generation, changed fingerprint, malformed labels, and duplicate resources all quarantine;
- immediate abort during process startup, a command that forks children, a command that ignores `SIGTERM`, and a detached client stream all end with no running Job container;
- successful process kill with a later remove failure records the execution outcome independently and keeps capacity held;
- destroy returns or throws while the container remains visible; cleanup does not verify;
- exact inspect `not found` plus an empty full-label query verifies cleanup;
- Docker socket timeout, permission denial, and daemon error never map to absence;
- anonymous volumes declared by an image are captured, removed, and verified absent;
- Runner crash in `provisioning`, `ready`, `termination_requested`, and `destruction_requested` reconciles without starting a second agent session;
- a durable cancellation wins over runner-loss classification and prevents a new publication claim;
- an active Job at Runner loss becomes `failed/runner_lost`, preserves only bounded partial artifacts, and tears down;
- each quarantined resource or duplicate consumes capacity, and zero available capacity prevents leasing;
- repeated reaper and duplicate teardown deliveries are idempotent;
- no retry duplicates `exec` or `writeFile` effects;
- provider-native errors and types do not escape the adapter; `providerRef` remains opaque metadata and never becomes an Ornn identity.

## Scope boundary

This contract is for the first personal Remote Runner with Docker. It does not add checkpointed Pi sessions, warm sandbox reuse, eviction, managed-provider TTLs, sidecars, named volumes, remote disks, or a general provider inventory. Daytona and other later drivers must meet the same Ornn outcomes, but this work does not design their recovery mechanisms.

The result is consistent with [ADR 0003](../adr/0003-track-execution-and-cleanup-independently.md) and [ADR 0005](../adr/0005-keep-the-sandbox-driver-generic.md). It tightens the earlier `terminate` sketch by separating whole-process-tree termination from verified destruction and by adding owned discovery for crash recovery. Those operations remain provider-neutral and stay within ADR 0005's lifecycle, inspection, process termination, and verified-destruction boundary.
