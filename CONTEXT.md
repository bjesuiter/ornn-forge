# Ornn Forge

Ornn Forge receives bounded work from GitHub and returns inspectable results produced in isolated execution environments.

## Language

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

**Embedded Runner**:
A Runner that operates inside the control plane and receives assigned jobs directly.
_Avoid_: Control-plane worker, local Runner

**Remote Runner**:
An independently deployed Runner that receives job leases from the control plane.
_Avoid_: Runner daemon, worker, agent

**Runner capacity**:
The maximum number of capacity reservations a Runner may hold concurrently. A job retains its reservation until sandbox cleanup is verified, including while cleanup is pending or failed.
_Avoid_: Worker count, parallelism

**Capacity reservation**:
A Runner slot held from job admission until verified sandbox cleanup. A quarantined sandbox continues to hold its reservation after execution ends.
_Avoid_: Worker slot, concurrency token

**Runner credential**:
A renewable model-provider credential owned and stored by one Runner. It is never exposed to a sandbox, the control plane, or another Runner.
_Avoid_: Shared token, agent credential

**Reauthentication attempt**:
A control-plane-visible interaction through which the operator restores one Runner's model access while credential exchange and storage remain on that Runner. It contains only one-time instructions and status, not a reusable credential.
_Avoid_: Credential transfer, token sync

**Sandbox driver**:
A replaceable component through which a Runner manages sandbox lifecycle, process execution, file transfer, process-tree termination, inspection, and verified destruction. Git, GitHub, agent-engine, and provider types remain outside its interface.
_Avoid_: Sandbox provider, sandbox runner

**Sandbox**:
An isolated, writable execution environment assigned to one job and never reused by another. Its workspace may survive a Runner restart so the job can recover, but it is removed during verified sandbox teardown.
_Avoid_: Runner, container
