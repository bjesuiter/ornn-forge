# Ornn Forge

Ornn Forge receives bounded work from GitHub and returns inspectable results produced in isolated execution environments.

## Language

**Operator**:
A GitHub account explicitly authorized to use Ornn Forge's control plane. Browser dashboard sessions and API bearer credentials are separate ways to establish one Operator's identity.
_Avoid_: Admin, user

**Operator bearer credential**:
A static secret bound to one Operator and accepted only by the control-plane API.
_Avoid_: Login credential, dashboard session

**Dashboard session**:
A time-limited browser session that identifies an Operator for access to the control-plane dashboard. It does not authorize the control-plane API.
_Avoid_: Operator bearer credential, API token

**Rejected dashboard login**:
A retained record that a GitHub identity outside the Operator allowlist attempted to obtain a Dashboard session.
_Avoid_: Failed Invocation, API authorization failure

**Invocation**:
An explicit, authorized request for Ornn Forge to act on a GitHub issue or pull request.
_Avoid_: Trigger, command

**Clarification request**:
An auditable question attached to an invocation when Ornn lacks enough information to select or execute a flow safely. It has a short reference, and a reply from the authorized invoker resumes the pending interaction.
_Avoid_: New invocation, prompt, approval

**Ornn message**:
A durable message that Ornn publishes as a GitHub comment and records with its structured content. Every Ornn message has an Ornn message ID and may represent progress, a clarification request, an artifact, or another Job event.
_Avoid_: Comment, response, artifact

**Ornn message ID**:
An opaque public reference shown in an Ornn message. It links the GitHub comment to Ornn's durable structured record and lets authorized callers discover related domain objects, but it grants no authority by itself.
_Avoid_: Database ID, authorization token, request ID

**Work order**:
The bounded instructions and repository context supplied by an invocation.
_Avoid_: Task, request, prompt

**Flow**:
An operator-defined, reusable recipe for turning a kind of invocation into an artifact. It defines work-order construction, agent configuration, capability grants, and artifact and publication rules; a job executes one resolved version.
_Avoid_: Job, runtime lifecycle

**Analysis artifact**:
The result of an Analyze Flow. It assesses whether the requested repository change is ready to implement and ends with operator decision questions, an implementation plan, or a technical blocker after Ornn exhausts the permitted cheap investigations. It records the strategies considered, affected code and contracts, risks, cleared concerns, and the evidence behind its safety claims.
_Avoid_: Read-only job, implementation result

**Cheap investigation**:
An investigation that a Job can perform with its current sandbox, repository, capability grants, credentials, and configured services. It may use web or codebase research and disposable local prototypes, but it requires no new infrastructure, external access, credential, paid resource, or operator setup.
_Avoid_: Next step, trivial investigation

**Flow routing**:
The decision that binds an invocation to a registered flow or produces a clarification request. Routing returns one of those outcomes explicitly rather than relying on command keywords or a numeric confidence score.
_Avoid_: Keyword routing, flow execution

**Job**:
One durable attempt to execute a resolved flow for a work order and report its outcome. Safe infrastructure retries remain within the job, but re-executing the agent creates a new job linked to the same invocation and work order.
_Avoid_: Run, workflow

**Job group (idea)**:
A proposed set of jobs allowed to exchange explicit messages and artifacts while working on one work order. This term is reserved for possible future use and does not describe current behavior.
_Avoid_: Shared session, shared Runner

**Artifact**:
An inspectable result returned by a job, such as an analysis comment, patch, log bundle, branch, or draft pull request.
_Avoid_: Output, response

**Change artifact**:
An immutable artifact representing repository changes prepared by a job but not yet published. It records the base and head commits plus integrity and provenance metadata.
_Avoid_: Working tree, pending branch

**Publication**:
An authorized external effect that turns an artifact into GitHub state, such as a result comment, job-owned branch, or draft pull request. Its policy is distinct from repository editing even when the selected provider lets the agent perform both inside one sandbox.
_Avoid_: Push, upload, write

**Publication mode**:
The policy and provider choice that determine where publication authority resides and how a Job turns an artifact into external state. Direct, brokered, and isolated publication modes can provide the same capability with different enforcement and operational cost.
_Avoid_: Capability, access level, Git command

**Capability**:
An operator-defined ability that Ornn can make available to an agent, such as anonymous web fetch or use of a particular CLI. One or more tools may provide the ability, but a capability is not a stage in Ornn's orchestration.
_Avoid_: Flow stage, internal operation, service

**Capability grant**:
A job-scoped authorization for an agent to use one capability within specified effect and access limits.
_Avoid_: Capability, tool installation, credential

**Web research**:
An Ornn capability through which an agent engine retrieves public web material using Runner-hosted tools without granting network access to the sandbox. Research results retain their source provenance and remain untrusted input.
_Avoid_: Sandbox egress, browser access

**Execution outcome**:
The independently tracked result of attempting a work order: succeeded, failed, or cancelled. It does not describe whether sandbox teardown completed.
_Avoid_: Final status, cleanup result

**Cleanup status**:
The independently tracked state of sandbox teardown: pending, verified, or failed. A successful execution outcome may coexist with pending or failed cleanup.
_Avoid_: Execution outcome, job result

**Cancellation**:
An authorized instruction to stop a job's remaining work and prevent unpublished external effects. Cancellation preserves partial artifacts for inspection but does not undo effects that already completed.
_Avoid_: Rollback, deletion

**Agent engine**:
A replaceable component that executes a work order through a coding agent. An agent engine is separate from the model provider, Runner, and sandbox driver.
_Avoid_: Model, Runner, orchestrator

**Runner**:
A component that executes a job by combining an agent engine with a sandbox driver. A Runner may be embedded in the control plane or deployed remotely.
_Avoid_: Sandbox runner, worker, executor

**Runner identity**:
A control-plane-owned record with a stable Runner ID and configuration for one Runner. It may exist before a Remote Runner host has enrolled.
_Avoid_: Host identity, machine ID

**Runner instance**:
One process start under a Runner identity, identified by a new ephemeral instance ID for its control connection. It is not the durable Runner identity.
_Avoid_: Runner identity, host identity

**Embedded Runner**:
A Runner that operates inside the control plane and receives assigned jobs directly.
_Avoid_: Control-plane worker, local Runner

**Remote Runner**:
An independently deployed Runner that receives job leases from the control plane.
_Avoid_: Runner daemon, worker, agent

**Runner control connection**:
A reconnectable, header-authenticated real-time connection from one Remote Runner to the control plane for its running protocol, including lease, report, profile, and command messages. At most one execution connection is active for a Runner identity; an update handover may additionally hold one draining and one candidate connection. It is not the durable source of Runner or command state.
_Avoid_: Polling channel, Runner identity

**Runner presence**:
The control plane's current observation that a Remote Runner has sent a timely authenticated protocol heartbeat. Presence does not imply Runner readiness.
_Avoid_: Runner readiness, WebSocket state

**Runner synchronization**:
The reconnect exchange in which a Remote Runner and the control plane reconcile active leases, command-journal state, and desired configuration after connection loss or restart.
_Avoid_: Runner presence, Runner command delivery

**Runner command**:
A durable, control-plane-authored instruction for one Remote Runner with a unique Command ID. Delivery may be repeated until terminal acknowledgement, and the Runner deduplicates it by Command ID.
_Avoid_: Job lease, Runner configuration

**Runner command acknowledgement**:
A Runner's durable report that a Runner command was accepted for execution or reached a terminal outcome. Delivery acknowledgement and command outcome are distinct.
_Avoid_: Command delivery, command outcome

**Runner command journal**:
A Runner-owned durable record of Command IDs, acknowledgements, outcomes, and timestamps used to deduplicate Runner commands across restart. Terminal entries are retained for 30 days; it contains no provider credential or device-authorization material.
_Avoid_: Runner credential store, command queue

**Runner desired configuration**:
Operator-controlled durable configuration for one Runner, such as pause or capacity, that remains in effect across connection loss and restart. It is not a Runner command.
_Avoid_: Runner command, Runner host profile

**Remote Runner enrollment**:
The one-time process that binds a Control-Plane-created Remote Runner identity to a host-held Runner transport credential.
_Avoid_: Runner registration

**Runner setup**:
A host-local operation that installs a Remote Runner service, persists its transport credential, and performs Remote Runner enrollment.
_Avoid_: Runner enrollment

**Runner setup preflight**:
A token-only control-plane validation that must succeed before Runner setup creates a Runner transport credential.
_Avoid_: Remote Runner enrollment

**Enrolled Remote Runner**:
A Remote Runner whose Runner transport credential digest is bound to its Runner identity. It may still have no available model capacity.
_Avoid_: Ready Runner, authenticated model Runner

**Awaiting-setup Remote Runner**:
A Remote Runner identity created by the control plane but not yet bound to a Runner transport credential.
_Avoid_: Enrolled Remote Runner

**Runner replacement**:
A host-local Runner setup transition that replaces one installed Runner identity with another and reports the replaced identity to the control plane for audit. It does not change the replaced identity's control-plane state.
_Avoid_: Runner transport credential rotation

**Runner decommission**:
An Operator-controlled permanent deactivation of a Runner identity that immediately prevents new leases and invalidates its Runner transport credential. Normal decommission requires a paused Runner with no capacity reservations; force decommission handles an unavailable or compromised host. An already authenticated control connection may acknowledge a best-effort local cleanup but cannot reconnect. Decommission succeeds even when the host is offline.
_Avoid_: Runner pause, Runner replacement

**Setup token**:
A short-lived, single-use opaque bearer secret bound by the control plane to one Remote Runner identity that permits Remote Runner enrollment. Regenerating one invalidates the prior unconsumed token for that identity. It is not used to authenticate normal Runner requests.
_Avoid_: Runner transport credential, API token

**Runner transport credential**:
A durable bearer secret held by one Remote Runner and represented by a digest in the control plane. It authenticates that Runner's control-plane requests and is distinct from its model-provider credentials.
_Avoid_: Runner credential, setup token

**Runner transport credential rotation**:
The controlled replacement of the Runner transport credential for one enrolled Remote Runner identity. It normally completes only after the Runner is paused and holds no capacity reservations; a force rotation invalidates the prior transport credential immediately.
_Avoid_: Runner replacement

**Runner readiness**:
The condition in which an enrolled Remote Runner can advertise capacity because its required Runner credentials are usable. Enrollment alone does not establish readiness.
_Avoid_: Enrollment, Runner presence

**Runner capacity**:
The Operator-selected maximum number of capacity reservations a Runner may hold concurrently. The control plane may use its Runner host profile to choose the limit, but the Runner does not set it. A job retains its reservation until sandbox cleanup is verified, including while cleanup is pending or failed.
_Avoid_: Worker count, parallelism

**Runner host profile**:
A compact, point-in-time description of a Remote Runner host that helps an Operator choose Runner capacity. In v1 it is not a telemetry stream or a monitoring system.
_Avoid_: Metrics, monitoring, telemetry

**Runner availability report (planned)**:
A bounded recurring report from a Remote Runner with ready slots and coarse resource-pressure signals for later scheduling policy. It is not raw metrics or a time-series history.
_Avoid_: Host metrics, monitoring stream

**Runner pause**:
An Operator-controlled state that prevents a Runner from receiving new Job leases. It does not stop a Job the Runner is already executing.
_Avoid_: Offline state, cancellation

**Capacity reservation**:
A Runner slot held from job admission until verified sandbox cleanup. A quarantined sandbox continues to hold its reservation after execution ends.
_Avoid_: Worker slot, concurrency token

**Lease acceptance**:
A Runner's explicit confirmation that it will execute an offered lease. Until the lease reaches a terminal state or expires, it remains exclusive to that Runner.
_Avoid_: Lease offer, Job admission

**Runner credential**:
A renewable model-provider credential owned and stored by one Runner. It is never exposed to a sandbox, the control plane, or another Runner.
_Avoid_: Shared token, agent credential

**Reauthentication attempt**:
A control-plane-visible interaction through which the operator restores one Runner's named model-provider access while credential exchange and storage remain on that Runner. It contains only one-time instructions and status, not a reusable credential; it does not block unrelated Runner commands. A Runner without a usable model credential remains unready for the attempt's duration. V1 supports the `openai-codex` provider only.
_Avoid_: Credential transfer, token sync

**Runner release**:
An immutable published version of the Runner package identified by its version and package-integrity value.
_Avoid_: Latest Runner, package URL

**Runner update**:
A control-plane-authored Runner command that installs one verified Runner release and transitions one Runner service to it. At most one execution-capable process may operate under the Runner identity during the transition; the update does not change the identity or its credentials.
_Avoid_: Runner setup, arbitrary remote code execution

**Runner update handover**:
A guarded update interval with one active execution connection and, at most, one draining old-version connection plus one candidate new-version connection. Draining and candidate connections cannot receive Job leases, and a candidate does not access model credentials before promotion. After promotion, the old version remains draining for a bounded rollback window.
_Avoid_: Multiple active Runners, Runner replacement

**Sandbox driver**:
A replaceable component through which a Runner manages sandbox lifecycle, process execution, file transfer, process-tree termination, inspection, and verified destruction. Git, GitHub, agent-engine, and provider types remain outside its interface.
_Avoid_: Sandbox provider, sandbox runner

**Sandbox**:
An isolated, writable execution environment assigned to one job and never reused by another. Its workspace may survive a Runner restart so the job can recover, but it is removed during verified sandbox teardown.
_Avoid_: Runner, container
