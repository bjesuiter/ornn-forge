# Ornn Forge Vision

## Purpose

Ornn Forge turns a work order on GitHub into a verified artifact.

It is a focused agent orchestrator, not a general assistant. A user invokes Ornn from an issue or pull request, adds a custom prompt, and receives an analysis, code change, or draft pull request produced inside an isolated sandbox.

## The initial experience

1. Capture an idea in a GitHub issue.
2. Refine the issue into an executable work order, optionally with OpenClaw workflows such as Wayfinder or `grill-with-docs`.
3. Invoke Ornn with a custom prompt, for example:

   ```text
   @ornn-forge analyze whether this design fits the current architecture.
   ```

   ```text
   @ornn-forge implement this issue, run the relevant checks, and open a draft PR.
   ```

4. Ornn verifies the request, creates an isolated sandbox, checks out the repository at a pinned revision, and executes the prompt.
5. Ornn reports progress and returns a durable artifact to GitHub.

GitHub is the initial user interface, authorization surface, audit trail, and result history. Mention-based activation avoids a separate tracked-repository configuration: the GitHub App installation defines which repositories Ornn can access, while the mention defines when it should act.

After an authorized mention, Ornn uses a model to route the invocation to a registered flow instead of depending on command keywords. The router must return either a selected registered flow with requested overrides or a concrete clarification question; a self-reported confidence score does not authorize execution. Routing receives the registered flow catalog, issue title and body, invoking comment, and authorized clarification replies. It does not receive repository contents or the whole issue thread by default.

Ornn creates a Job only after routing selects a Flow and resolves its permitted overrides. A routing clarification remains attached to the Invocation and does not reserve Runner capacity, create a sandbox, or start an agent session.

If Ornn cannot choose safely, it asks for clarification on the GitHub issue before executing the flow. Every GitHub comment published by Ornn is an Ornn message with a visible Ornn message ID. The comment ends with a compact self-link whose text is only the `om_...` ID. D1 maps that ID to the structured message content and its related Invocation, Job, interaction, or artifact. Workflow state may reference the same message, but D1 remains authoritative after the workflow finishes. The ID is public correlation data and grants no authority. An authorized Invocation may use an Ornn message ID as an anchor and refer to related objects, such as "the artifact from the first Job." The control plane queries D1 for candidates, lets the router interpret the relative phrase only among those candidates, and requests clarification if more than one object still matches. In the first slice, only the control plane acting for an authenticated operator Invocation or UI session, and a Runner acting within its current Job lease, may resolve the structured record. A reply from the authorized invoker resumes the sole pending interaction without another mention or explicit reference; when several interactions are pending on one issue, the reply must include the relevant Ornn message ID. GitHub comments are the first human-in-the-loop interface; a later dashboard should collect routing questions and approvals when comments become too noisy. The intended direction is increasing autonomy after invocation as routing and approval policy mature.

The first experimental flow router calls paid OpenCode Zen from the control plane through TanStack AI and pins `gemini-3.5-flash-lite`. It passed all 28 contract attempts and was materially faster and cheaper than the other perfect Zen candidate. The API key remains a control-plane secret, and routing uses pay-as-you-go billing with an operator-configured spending limit. Production use also requires confirmation that unattended internal routing complies with OpenCode's hosted-service terms. Cloudflare Workers AI is easier to integrate through its native binding, but its best tested candidate, Nemotron 3, was slower and more expensive at the same routing contract; retain it as a tested fallback rather than the initial provider. See [the Zen router benchmark](docs/research/opencode-go-router-benchmark.md) and [Workers AI comparison](docs/research/cloudflare-workers-ai-router-benchmark.md).

## Architecture Direction

- **GitHub App:** receives signed webhook events and acts with narrowly scoped installation permissions.
- **Cloudflare control plane:** authenticates requests, manages durable job state, retries, cancellation, and result delivery.
- **Flow router:** uses TanStack AI behind an Ornn-owned interface to select a registered flow or request clarification. Paid OpenCode Zen with pinned Gemini 3.5 Flash Lite is first; Cloudflare Workers AI Nemotron 3 is the tested native fallback.
- **Flows:** define reusable, operator-controlled TypeScript recipes for constructing work orders, configuring agents, granting capabilities, and handling artifacts and publication. A job executes one resolved flow version. Analyze and Implement are separate registered flows. The first implementation may use TanStack Workflow for durable execution behind Ornn's domain contracts.
- **Runners:** execute jobs by combining a selected agent engine with a sandbox driver. The control plane may contain an Embedded Runner, while independently deployed Remote Runners receive job leases.
- **Agent engines:** execute work orders without owning repository access, job state, or artifact publication. Pi is first and Codex is the first replacement proof.
- **Sandbox drivers:** create and control isolated environments behind an Ornn-owned interface. Docker is first and Daytona's managed service is the first remote replacement proof.
- **TanStack AI sandbox providers:** supply internal sandbox implementations through one pinned adapter. TanStack types remain inside that adapter.

Cloudflare is the control plane and may host an Embedded Runner, but it is not necessarily the sandbox plane. The first flow uses a Remote Runner on `homeserv1`; a later Embedded Runner may operate Daytona sandboxes without depending on that machine.

Ornn-owned concepts such as jobs, work orders, permissions, progress, artifacts, Runners, and sandboxes remain independent from TanStack and concrete sandbox platforms. Ornn owns a small `SandboxDriver` interface that adds its security, cancellation, error, provenance, and verified-cleanup guarantees. One internal TanStack adapter reuses bundled or custom `SandboxProvider` implementations behind that interface.

D1 is the authoritative audit and inspection store. Immutable domain records capture admitted inputs, resolved Jobs, leases, grants, Ornn message revisions, and structured analysis artifacts. A versioned append-only event stream records their lifecycle; mutable summaries remain rebuildable projections. The authenticated operator reads these records through a small JSON API, including lookup by Ornn message ID. A Remote Runner can append allowlisted observations and resolve related messages only for its authenticated current lease. Workers Observability and OpenTelemetry are derived diagnostics, not state. Sanitized R2 diagnostics expire after 30 days while D1 keeps their metadata until manual purge. See [the audit and inspection contract](docs/research/analyze-flow-audit-and-inspection-contract.md).

Agent engines may receive a job-scoped grant for an Ornn-owned web research capability hosted by the trusted Runner. The first provider reuses `code-yeongyu/pi-webfetch` at an exact commit pin. It provides one anonymous supplied-URL tool with bounded time, response size, and model-facing output. Its lack of private-network blocking and DNS pinning is an accepted risk for the personal first version. It does not grant general network access to the sandbox. Only operator-approved Runner configuration may expose tools; repository-provided extensions and MCP configuration cannot expand a job's capability grants. See [the extension assessment](docs/research/pi-anonymous-web-fetch.md).

Analyze and Implement Flows grant anonymous web fetch by default. Authenticated web access and specialized CLIs require separate grants. Retrieved material remains untrusted input.

Each flow supplies usable defaults, including its normal capability grants and logical providers. Deployment configuration binds those providers to concrete services, credentials, and execution locations. An authorized invoker may request an override in the invocation prompt or a later clarification reply, but the resolved grant must remain within operator policy. Issue content, other users' comments, and repository files cannot authorize an override. Later, a running agent may request an additional grant through an explicit human approval. Capability identity does not prescribe execution location; a trusted provider may run on the Runner, route work into the sandbox, or invoke a separate publisher.

## What Belongs in the Vision

### Prompt execution

Ornn flows can construct custom work orders rather than exposing only one hard-coded prompt.

Examples:

- Analyze an issue against the current codebase and comment with findings.
- Investigate a bug without changing the repository.
- Implement an approved issue on a new branch.
- Run tests and checks relevant to the change.
- Push the branch and open a draft pull request.
- Collect logs, patches, and other useful artifacts from the run.

The Analyze Flow starts by comparing the issue's requested change with the repository at the job's pinned revision. It checks whether the intended behavior and acceptance criteria are specific enough, identifies decisions that only the operator can make, and finds or generates one or more viable implementation strategies. It compares the blast radius of all viable strategies, selects one when repository evidence makes the choice clear, and applies a pinned, operator-reviewed copy of pstack's [`blast-radius` skill](https://github.com/cursor/plugins/blob/e46364b8be46000b7df0f260550cd712afbb8d36/pstack/skills/blast-radius/SKILL.md) in full to that strategy. The check follows effects that symbol searches miss, identifies the facts the strategy's safety depends on, and proves those facts by running the real code when that is cheap. Any fact that cannot reach runtime proof is marked unproven. If the operator selects another strategy, Ornn runs the full check for that strategy on demand.

The resulting analysis artifact has a durable structured representation in D1 and a human-readable Ornn message on GitHub. It ends with focused questions about decisions only the operator can make, an implementation plan, or a technical blocker. Ornn does not turn missing technical investigation into an operator question. When it finds a technical blocker, it updates one progress message with the current finding and continues with the next cheap investigation. D1 retains the underlying progress events and message revisions. A cheap investigation uses the Job's existing sandbox, repository, grants, credentials, and configured services. Web research, codebase research, and disposable local prototypes qualify. Provisioning infrastructure, obtaining access or credentials, configuring a new paid resource, and other operator setup do not. The Flow defines hard limits; the agent chooses and orders investigations inside them. A soft threshold tells the agent to finish its current investigation and preserve a coherent artifact before the hard limit blocks further capability use. Ornn returns `blocked` only after it exhausts the cheap investigations. The blocked result records the evidence and the next investigation that needs new setup, authority, access, or budget. A future runtime request may pause the Job and ask for that setup. The plan records the selected strategy, alternatives considered, expected changes, affected code and contracts, risks, cleared concerns, proof already run, and the checks that implementation must still perform.

An authorized Implement Invocation may use a prior analysis artifact. Ornn infers it when exactly one eligible plan exists and requires a reference when several plans could apply. Before implementation, Ornn compares the artifact's pinned repository revision with the new Job's revision and revalidates the plan, its safety claims, and its blast radius against relevant intervening changes. It does not treat an old plan as current merely because it belongs to the same issue.

When analysis needs an operator decision, the Job pauses and keeps its Pi session, sandbox, and Runner capacity reservation. An authorized reply resumes the same Job. This is acceptable for the first personal Runner; eviction, checkpointing, and other idle-cost optimizations come later.

### Safe GitHub-native operation

- Trigger work through an explicit invocation such as `@ornn-forge`.
- Verify the webhook signature, installation, repository, and invoking actor.
- Treat issue text, comments, and repository contents as untrusted input.
- Pin repository checkout to an exact revision.
- Give every job a writable, disposable sandbox workspace. Analysis jobs may write temporary files inside that workspace but cannot publish repository changes.
- Let an Analyze Job edit its checkout, create proof scripts and tests, make local commits, and run prototypes when needed to test a claim. These changes remain inside the sandbox. The analysis artifact preserves relevant evidence before cleanup.
- Treat the standard sandbox environment, toolchain, and pinned repository workspace as execution prerequisites rather than Capability grants. Capability grants control additional agent abilities and external effects.
- Restrict implementation jobs to branches and draft pull requests.
- Never write directly to a protected or default branch.
- The first Implement Flow defaults to Level 3 direct sandbox publication. After the Job enters its publication phase, its sandbox receives a short-lived GitHub App installation token scoped to one repository with `Contents: write` and `Pull requests: write`. Never place the operator's personal GitHub credential or GitHub App administration permission in a sandbox. GitHub does not scope this token to the intended branch, so branch, force-push, and deletion restrictions remain agent policy. The first version does not require repository rules to enforce them.
- Treat an authorized Implement Invocation as authority to push the job-owned branch and create or update its draft pull request without another approval. Do not impose a separate numeric limit on pushes or draft-pull-request updates while the Job remains active; the Job's overall time and capability limits still apply. Remove or revoke its token when the Job becomes terminal or is cancelled.
- Treat repository automation normally triggered by the job-owned branch or draft pull request as part of the authorized publication. Report detected automation during analysis and ask only when an effect falls outside Flow policy.
- If one publication operation succeeds and a later operation fails, retain the published branch or pull request, record the partial state in D1, and retry the remaining operation idempotently.
- Level 2 brokered publication and Level 1 isolated change-artifact publication are later hardening.
- Use short-lived, narrowly scoped credentials.

### Reliable isolated jobs

- Create exactly one fresh agent session and one sandbox for each job. The first slice does not split a job across agent sessions or use agent-level parallel workers.
- A shared Runner must keep each job's capability grants, tools, session state, and sandbox lease scoped to that job. One job cannot enumerate or read another job's state.
- On `homeserv1`, give the Runner service a store key through systemd encrypted credentials and use it to encrypt Pi's mutable OAuth record in a Runner-owned credential store. This v1 mechanism supports unattended restart but does not claim protection from root compromise or offline theft of the unencrypted system disk.
- Stream or persist progress so a run can be observed.
- Store authoritative per-Job duration, limit interruption, model and tool usage, provider quota, and billed-cost records in D1 when the provider reports them. Export derived OpenTelemetry metrics for inspection. Use those measurements to revise versioned Flow limits instead of silently raising limits during a Job.
- Support cancellation, timeouts, retries, and deterministic cleanup.
- Normalize sandbox failures into seven stable codes and record whether a failed mutation definitely had no effect or may have had one. Reconcile uncertain effects before retrying.
- Keep durable job state outside the sandbox.
- Handle duplicate webhook delivery without creating duplicate work.
- Keep safe infrastructure retries within one job, but create a new linked job when the agent must execute again after an ambiguous or terminal failure.
- Pin each job to its resolved flow version and configuration. An authorized invoker may restart against a newer flow version, which creates a new linked job and preserves the original job record.
- Let only the authorized invoker or operator cancel a job. Cancellation prevents new capability use, signals the agent engine, terminates the sandbox process tree, preserves partial artifacts privately, and prevents publication that has not already claimed its durable idempotency key.
- Preserve useful results even when execution fails.
- Track execution outcome and cleanup status independently. Successful work may be published with a visible cleanup warning while the reaper continues teardown attempts.
- Keep a job's Runner capacity reservation until sandbox cleanup is verified. Pending or failed cleanup can exhaust capacity and stop the Runner from leasing more jobs.
- For the first Docker Runner, cancel the whole Job container, verify that its owned container and anonymous volumes are absent, and quarantine any resource whose deletion remains uncertain. Continue reaping without declaring success after a fixed retry count.
- Use durable workflow primitives for replay-safe steps, signals, approvals, retries, and pauses. Keep Ornn's job records and policy authoritative when a workflow library implements those mechanics.

### Sandbox-driver portability

- Select a sandbox driver without changing GitHub-facing behavior or the agent engine.
- Keep the sandbox-driver interface limited to lifecycle, inspection, process execution and termination, file transfer, and verified destruction. Repository, GitHub, agent-engine, and provider concepts remain outside it.
- Keep provider-specific setup, networking, secret injection, snapshots, identifiers, and cleanup inside the sandbox-driver module.
- Reuse TanStack providers only after they pass Ornn's sandbox-driver contract tests.
- Permit additional TanStack-compatible providers and direct Ornn adapters without changing callers.

## What Explicitly Does Not Belong Yet

### A general-purpose OpenClaw agent

Ornn does not initially need personal memory, broad messaging integrations, an assistant personality, proactive life management, or open-ended conversations. Igris can refine and coordinate work; Ornn executes bounded work orders.

### A new project-management interface

No custom dashboard, backlog, issue tracker, or mandatory repository registry for the MVP. GitHub already supplies the work surface and history.

### Autonomous unrequested work

Ornn must not continuously watch repositories and decide by itself what to change. It acts only after an authorized, explicit invocation.

### Direct production authority

Ornn must not merge pull requests, push to protected branches, deploy to production, rotate secrets, modify billing, or perform other high-impact external actions merely because repository text asks it to.

### Sandbox-platform lock-in

The core must not depend directly on TanStack types or one sandbox vendor's job model, filesystem interface, lifecycle, or persistence semantics.

### A closed flow taxonomy

Analysis and implementation are useful initial flows, not a closed universe of task types. Operators may define more flows from the same Ornn-owned concepts without adding new job lifecycle machinery.

### Multi-job collaboration

Status: idea only. Do not implement in the current scope.

A future Job group may let isolated jobs exchange explicit, durable messages and artifacts while working on one work order. Jobs must not gain access to each other's Pi sessions, host memory, or writable sandboxes. Runner co-location may improve efficiency but must not be required for collaboration.

### Marketplace-scale product features

Multi-tenant billing, public onboarding, broad marketplace distribution, enterprise administration, and a polished standalone UI are outside the current vision. Ornn Forge starts as a focused tool for JB's repositories.

## First Vertical Slice

The first complete slice is deliberately analysis-only. Its sandbox remains writable so the agent can create temporary files, experiments, and proof scripts, but the job cannot publish repository changes:

```text
GitHub issue comment with @ornn-forge analyze <prompt>
  → verified webhook
  → flow routing or clarification
  → selected Analyze Flow
  → durable job
  → isolated sandbox
  → repository checkout at a pinned revision
  → readiness and implementation-strategy analysis
  → blast-radius checks with runtime evidence where cheap
  → operator decision questions or an implementation plan
  → structured analysis artifact stored in D1
  → human-readable Ornn message published with its Ornn message ID
  → deterministic cleanup
```

This is an engineering milestone, not a stage automatically prepended to implementation jobs. A later `implement` invocation performs its analysis, edits, checks, and commit preparation within one job and one sandbox.

Only after authorization, idempotency, observability, and cleanup are proven should Ornn add the implementation slice:

```text
@ornn-forge implement <prompt>
  → branch
  → code changes
  → checks
  → commit and push
  → draft pull request
```

## Identity

**Ornn Forge** is the forge operator: it receives a precise work order and returns something inspectable and durable.

Igris helps shape and command the work. Ornn forges the artifact.
