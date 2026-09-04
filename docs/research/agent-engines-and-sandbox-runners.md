# Agent engines and sandbox runners

Status: research complete
Last verified: 2026-09-04

## Decision

Start Ornn Forge with two Ornn-owned seams and a deliberately asymmetric first implementation:

1. **Agent engine:** implement `PiEngine` against Pi's TypeScript SDK. Run Pi in the trusted runner process, keep the OpenAI subscription credential there, and replace Pi's built-in filesystem and shell tools with Ornn tools that execute through a `SandboxRunner` handle.
2. **Sandbox runner:** implement the first `SandboxRunner` as a thin adapter over TanStack AI's plain-Docker provider on a dedicated, user-owned Linux runner. Pin the TanStack packages. Do not adopt TanStack's chat, job, persistence, or durable-run model.
3. **Runner connection:** begin with an outbound authenticated HTTPS lease loop from the runner to the Cloudflare control plane. Preserve transport as an internal runner concern. Add Iroh when attaching NATed personal machines is the next concrete goal.
4. **Second adapters:** implement `CodexEngine` next. Use an OpenShell adapter or a small fake remote runner to prove runner replaceability. Do not make Daytona foundational while its maintained implementation is private.

This is the best match for the stated constraints, not the shortest demo. Pi is the only evaluated engine that cleanly permits the long-lived OpenAI subscription credential to stay outside the untrusted workspace while Ornn redirects each tool operation into an independently managed sandbox. Codex is the faster all-in-one agent runtime, but its official SDK spawns Codex where the work runs. Isolated providers therefore need credentials inside the sandbox, while OpenAI recommends API-key authentication for programmatic automation. That conflicts with the subscription-only starting constraint and increases credential exposure.

The first runner should be treated as production-shaped only after its hardening checks pass: dedicated host, unprivileged job user, no Docker socket or host secrets mounted into jobs, resource limits, read-only base filesystem, dropped Linux capabilities, restrictive seccomp/AppArmor, allowlisted egress, deterministic cleanup, and a startup self-test that fails closed when those controls are absent. TanStack supplies a useful provider API and lifecycle mechanics; it does not establish these host-level guarantees for Ornn.

The recommendation remains reversible:

- Ornn owns the work order, job, artifact, event, engine, runner, and transport contracts.
- Pi, TanStack AI, Docker, Daytona, and Iroh remain adapters or implementation details.
- No provider-native session, snapshot, or run identifier becomes an Ornn identifier.
- A job records the resolved engine, model, context, runner, image digest, and adapter versions.

## The two contracts Ornn should own

The important design move is to keep **reasoning** separate from **capacity**. An agent engine decides which tool to call and emits semantic progress. A sandbox runner supplies an isolated workspace and performs concrete operations. Neither owns Ornn's durable job state.

### `AgentEngine`

The minimum useful contract is:

```ts
interface AgentEngine {
  run(input: {
    jobId: JobId
    workOrder: WorkOrder
    profile: ResolvedAgentProfile
    tools: EngineTools
    signal: AbortSignal
  }): AsyncIterable<AgentEvent>
}
```

`ResolvedAgentProfile` contains immutable engine, model, reasoning/context configuration, and policy values. `EngineTools` contains capability-oriented operations such as `readFile`, `listFiles`, `searchText`, and `exec`; it must not expose a Docker, Daytona, or TanStack object. `AgentEvent` should normalize text deltas, tool start/result, usage, engine session reference, warning, failure, and completion while retaining the original vendor event as optional diagnostic data.

The engine does **not** clone repositories, allocate capacity, publish GitHub comments, persist the canonical job, or decide whether a tool call is authorized.

### `SandboxRunner`

The minimum useful contract is:

```ts
interface SandboxRunner {
  create(spec: SandboxSpec): Promise<SandboxLease>
  inspect(lease: SandboxLease): Promise<SandboxState>
  exec(lease: SandboxLease, request: ExecRequest): Promise<ExecResult>
  readFile(lease: SandboxLease, path: RepoPath): Promise<Uint8Array>
  writeFile(lease: SandboxLease, path: RepoPath, data: Uint8Array): Promise<void>
  collectArtifacts(lease: SandboxLease, spec: ArtifactSpec): Promise<ArtifactManifest>
  terminate(lease: SandboxLease, reason: TerminationReason): Promise<void>
}
```

`SandboxSpec` includes a pinned image digest, CPU/memory/process/time quotas, workspace source at an immutable commit, network policy, permitted tools, and expiry. `create` returns an Ornn lease plus an opaque provider reference. `terminate` is idempotent, and completion is not accepted until `inspect` confirms the workload is gone. Snapshot/fork/resume are optional advertised capabilities, not required methods.

The runner does **not** choose a model, interpret a work order, own job retries, or publish artifacts. This lets a Pi engine use Docker today and Daytona later, and lets a future Codex engine use either runner without changing the GitHub-facing contract.

## Agent-engine comparison

| Criterion | Codex | Pi |
| --- | --- | --- |
| Integration API | Official TypeScript SDK; CLI JSONL is another usable boundary | TypeScript SDK, JSON event stream, and strict JSONL RPC mode |
| Control over tools | Codex supplies its coding-agent loop and built-in execution model | Built-in tools can be omitted or replaced with custom tools |
| Events and continuation | Structured streamed events, thread IDs, resume, JSON-schema output | Detailed agent/turn/message/tool events, steering, follow-up, abort, compaction, sessions |
| Model/provider selection | Model and reasoning effort per thread; OpenAI-oriented | Model/provider selected at runtime; provider registry supports OpenAI and later Anthropic |
| Subscription auth | ChatGPT login supported | ChatGPT Plus/Pro OAuth supported for OpenAI Codex models |
| Isolation stance | Built-in sandbox modes, but SDK launches a Codex subprocess on the execution host | Explicitly no built-in sandbox; host-side engine plus sandbox-routed custom tools is supported architecture |
| License | Apache-2.0 | MIT |
| Fit for Ornn | Excellent fast second engine; awkward with subscription credential isolation in an outer sandbox | Best first engine for a capability-composed system |

### Codex

The official [`@openai/codex-sdk` README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md) exposes threads, continued runs, streamed structured events, JSON-schema output, working-directory selection, and persisted sessions. Its implementation [spawns the packaged Codex executable](https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts) and passes model, sandbox, working directory, approval policy, network access, output schema, and cancellation settings. The exposed sandbox modes are `read-only`, `workspace-write`, and `danger-full-access`, and approval modes include `never` and `on-request` ([official SDK types](https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts)). Codex is [Apache-2.0 licensed](https://github.com/openai/codex/blob/main/LICENSE).

This is a strong narrow adapter boundary: Ornn can map streamed Codex items into `AgentEvent` and retain the Codex thread ID only as provider metadata. It is also the fastest way to prove a complete agent loop because Codex already owns tool selection, command execution, editing, and compaction.

The difficulty is placement. The SDK subprocess is the agent runtime. When a remote/container sandbox is the outer security boundary, Codex and its credential generally run inside it. TanStack's official Codex adapter confirms that isolated providers cannot use the host CLI login and instead receive credentials as workspace secrets; it also runs Codex with `danger-full-access` when an outer provider is expected to supply isolation ([TanStack Codex adapter](https://tanstack.com/ai/latest/docs/adapters/codex)). This is coherent for an API key that can be revoked and billed separately, but is a poor first fit for a renewable personal subscription credential.

Codex remains the recommended second engine. It will test whether Ornn's normalized events and profile resolution are genuinely engine-independent. It could become the first engine later if an acceptable credential broker appears, an API key becomes available, or the team explicitly accepts putting a copied subscription credential inside a short-lived sandbox.

### Pi

Pi describes itself as a minimal coding-agent runtime and intentionally omits built-in sandboxing, permission popups, MCP, and subagents ([Pi project documentation](https://pi.dev/); [official repository](https://github.com/earendil-works/pi)). The current packages use the `@earendil-works` scope and are [MIT licensed](https://github.com/earendil-works/pi/blob/main/LICENSE).

Its SDK creates an agent session with a selected model, tools, session manager, settings, resources, and authentication storage. A caller can prompt, steer, queue follow-ups, subscribe to events, abort, and dispose the session; the event stream includes agent, turn, message, tool-execution, retry, and compaction events ([Pi SDK](https://pi.dev/docs/latest/sdk)). Pi also exposes a JSON event stream and a strict JSONL RPC protocol, so Ornn has escape hatches if embedding the SDK later proves undesirable ([JSON mode](https://pi.dev/docs/latest/json); [RPC mode](https://pi.dev/docs/latest/rpc)).

Most importantly, Ornn can give Pi only custom tools. Pi's SDK documentation demonstrates replacing the default tool set, including a read-only selection, while its security documentation says tools and extensions otherwise have the launching process's permissions and recommends a container, VM, microVM, or routing tools into an isolated environment for unattended work ([SDK tool configuration](https://pi.dev/docs/latest/sdk); [Pi security model](https://pi.dev/docs/latest/security)). Pi documents both architectures explicitly. The whole Pi runtime can run inside a sandbox, or Pi can stay on the host and route its tools into the isolated environment. Its Gondolin example uses the latter to keep authentication on the host ([Pi containerization](https://pi.dev/docs/latest/containerization)).

That second topology maps directly to Ornn's desired capability composition:

```text
trusted runner process
  Pi session + OAuth token
       |
       | Ornn EngineTools
       v
  SandboxRunner handle
       |
       v
untrusted checkout + command processes
```

The cost is implementation work. Ornn must define and test the tool schema, translate tool calls, bound output, handle cancellation, and ensure that no Pi extension or default tool bypasses the runner. For the initial read-only analysis flow, the tool set can stay small: list, read, search, and bounded command execution. That is feasible within days and validates the architecture rather than hiding it.

## OpenAI subscription verification

An existing subscription can technically power either candidate engine:

- OpenAI states that Codex can be used by signing in with ChatGPT and that Codex is included with eligible ChatGPT plans; API-key use is billed separately ([OpenAI Codex plan guidance](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan-free-plus-pro-team-edu-and-enterprise)). The Codex authentication guide supports both ChatGPT and API-key authentication in local clients, including device-code or copied-auth-cache approaches for headless machines, but recommends API keys for programmatic Codex CLI workflows such as CI/CD ([OpenAI authentication guide](https://learn.chatgpt.com/docs/auth)).
- Pi's provider documentation supports a ChatGPT Plus/Pro OAuth login for OpenAI Codex models, stores and refreshes those tokens in its authentication store, and separately supports `OPENAI_API_KEY` ([Pi providers](https://pi.dev/docs/latest/providers)).

Therefore **access is verified, but production-safe credential placement is not automatic**. A ChatGPT subscription token is a renewable personal credential. It must never be copied into a repository, artifact, log, image, or snapshot. In the recommended Pi topology, the trusted runner owns the Pi auth store and the untrusted sandbox never mounts it. Ornn should give each engine a credential reference, never credential bytes, and redact subprocess environments and diagnostic events before persistence.

Model names and availability should be discovered from the engine/provider at runtime and resolved from an operator allowlist. Ornn should not encode today's marketing names in its domain model. Each job records the exact resolved model ID and engine version.

## Sandbox and transport comparison

| Candidate | What it is | Isolation and lifecycle | Self-hosting/license | Cloudflare-control-plane fit | Fit behind `SandboxRunner` |
| --- | --- | --- | --- | --- | --- |
| TanStack AI sandbox | TypeScript provider/workspace/agent abstraction | Local process, Docker container, Docker Sandbox microVM, and managed providers; lifecycle/snapshot helpers | Library is MIT; plain Docker provider is self-hostable | Runs on a Node-capable runner; Cloudflare-native path requires Containers and Durable Objects | Very clean provider API, but young and broader than Ornn needs |
| Daytona | Sandbox control/compute platform | Container or VM classes; start/stop/pause/archive/delete, TTL, snapshots/forks depending on class | Last public self-hostable release is frozen under AGPL-3.0; current implementation is private | Remote REST API fits; maintained service is vendor-controlled | Useful comparison, but no longer an acceptable foundation |
| Iroh | QUIC-based authenticated peer connectivity | Transport only; no compute isolation or workspace lifecycle | Relay and endpoint are self-hostable; MIT/Apache-2.0 | Native Rust/Node endpoint does not run directly in Workers; needs a gateway/service outside Workers | Good future runner transport, not a runner |
| NVIDIA OpenShell | Agent sandbox gateway and local supervisor | Docker, Podman, Kubernetes, or microVM; filesystem/process/network/inference policies | Self-hostable; Apache-2.0 | HTTPS/gRPC gateway can sit behind an adapter, but duplicates Ornn control-plane concerns | Excellent security comparison; too immature and overlapping for first runner |

### TanStack AI sandbox approach

TanStack separates a sandbox into provider, workspace, policy, and agent runtime. Every provider implements a common `SandboxProvider`/`SandboxHandle` interface. The official provider matrix includes an unsafe local process, plain Docker containers, Docker Sandbox microVMs, Daytona, and several hosted providers ([provider documentation](https://tanstack.com/ai/latest/docs/sandbox/providers)). The core lifecycle can resume or create a sandbox, bootstrap a workspace, take a snapshot, run the agent, then snapshot or destroy it ([lifecycle documentation](https://tanstack.com/ai/latest/docs/sandbox/lifecycle)). The project is [MIT licensed](https://github.com/TanStack/ai/blob/main/LICENSE).

This is close to the runner interface Ornn needs. Use that overlap to save code, but keep ownership in Ornn:

- Wrap only the selected provider package behind Ornn's `SandboxRunner`.
- Keep Git checkout verification, job retries, canonical events, artifact persistence, and cleanup evidence in Ornn.
- Feature-detect snapshot, fork, background-process, writable-stdin, port, and network-policy capabilities rather than assuming parity.
- Pin exact package versions. TanStack AI remains on a `v0` documentation track and the sandbox APIs are changing; the repository changelog is the evidence to review at each upgrade ([sandbox package changelog](https://github.com/TanStack/ai/blob/main/packages/ai-sandbox/CHANGELOG.md)).

For the first self-hosted provider, plain Docker has the fewest dependencies. The TanStack provider supplies create, exec, filesystem access, commit-based snapshots, fork, resume, and destroy. Its claim of a "real container boundary" is useful but not a complete Ornn threat model ([Docker provider details](https://tanstack.com/ai/latest/docs/sandbox/providers#docker)). Ornn must configure and verify host-level limits itself. The local-process provider is explicitly unisolated and is suitable only for tests.

Docker Sandboxes offers a hypervisor microVM through the same package, but requires the `sbx` CLI, a Docker login, and a supported hypervisor. It is therefore not the default self-hostable baseline. It is a later hardening experiment if its licensing, offline behavior, and automation terms satisfy the no-vendor-dependency requirement ([Docker Sandboxes provider details](https://tanstack.com/ai/latest/docs/sandbox/providers#docker-sandboxes-sbx)).

TanStack also documents a Cloudflare-native topology using Cloudflare Containers, a Durable Object coordinator, and R2 artifacts ([Cloudflare sandbox guide](https://tanstack.com/ai/latest/docs/sandbox/cloudflare)). It is not selected: Containers are an additional Cloudflare service not yet approved, the container filesystem is not durable, and provider cancellation destroys the container because Workers RPC cannot kill a single process. The user should make a portability decision before this path is used.

### Daytona

Daytona provides SDKs, CLI, and REST APIs for creating and operating sandboxes, including process execution, files, Git, networking, snapshots, and lifecycle controls ([official repository](https://github.com/daytonaio/daytona); [TypeScript Sandbox API](https://www.daytona.io/docs/en/typescript-sdk/sandbox/)). Its documented architecture separates interface, control, and compute planes. Runners poll the control plane for work and a sandbox daemon exposes toolbox operations ([Daytona architecture](https://www.daytona.io/docs/en/architecture/)). This validates Ornn's notion of replaceable capacity runners.

Lifecycle support is broad but class-dependent. Daytona documents Linux containers plus VM and GPU classes, with start/stop and persistence controls; pause, hot snapshots, and fork are VM-class capabilities, while containers use stop/start and cold snapshots ([sandbox classes](https://www.daytona.io/docs/sandboxes); [persistence](https://www.daytona.io/docs/en/persistence/)). The SDK also exposes TTL, auto-stop/archive/delete, network settings, domain allowlists, and an OpenTelemetry endpoint. REST clients authenticate with a bearer API key and accept a configurable API URL ([official generated clients](https://github.com/daytonaio/clients)).

The self-hosting story changed after the original candidate list was written. Daytona's public repository now says that core development moved to a private codebase in June 2026 and that the public repository will receive no updates, fixes, or releases ([current repository notice](https://github.com/daytonaio/daytona/blob/main/README.md)). The last public `v0.190.0` source remains forkable under [AGPL-3.0](https://github.com/daytonaio/daytona/blob/v0.190.0/LICENSE) and includes a [Docker Compose deployment](https://github.com/daytonaio/daytona/blob/v0.190.0/docker/docker-compose.yaml). That deployment runs API, proxy, runner, SSH gateway, Postgres, Redis, identity, registry, object storage, tracing, and administration services. Its runner is privileged and sets `RESOURCE_LIMITS_DISABLED=true`.

Daytona is therefore self-hostable only in the narrow sense that Ornn can operate or fork the frozen `v0.190.0` code. Today's maintained product is not independently operable from public source. The official current documentation and SDK describe the managed service, and TanStack's Daytona provider explicitly requires a Daytona API key for that service ([TanStack provider matrix](https://tanstack.com/ai/latest/docs/sandbox/providers#choosing-a-provider)). This fails the project's maintained self-hosting and low-lock-in tests.

Do not start with Daytona under the current constraints. The managed service violates the no-paid-vendor preference, while the public self-host stack is frozen, operationally large, privileged by default, and disables resource limits in its sample configuration. A Daytona adapter may still be useful as a disposable compatibility test, but it should not be the proof that Ornn has a durable self-hosting exit. If used, pin the public version or API contract and require `terminate` to wait for and verify deletion rather than trusting a fire-and-forget API response.

### Iroh

Iroh is a Rust QUIC networking stack, not a sandbox system. Endpoints authenticate by endpoint ID, attempt direct connectivity using hole punching, and fall back to relays when direct paths fail ([NAT traversal](https://docs.iroh.computer/concepts/nat-traversal); [QUIC usage](https://docs.iroh.computer/protocols/using-quic)). Relayed traffic remains end-to-end encrypted. The public relays are intended for development and are rate-limited; production applications should operate dedicated relays. Relays are stateless and can be self-hosted ([Iroh FAQ](https://docs.iroh.computer/about/faq); [running a relay](https://docs.iroh.computer/add-a-relay)). The repository is dual [MIT/Apache-2.0 licensed](https://github.com/n0-computer/iroh).

Iroh is a good fit for a later user-owned runner connection because runners behind NAT can enroll and connect without inbound port forwarding, while Ornn owns enrollment, runner identity, authorization, leasing, heartbeats, and job protocol. An endpoint ID is an authenticated transport identity, not sufficient application authorization; Ornn still needs a revocable runner registry and job-scoped signed grants.

It is not the first transport for the Cloudflare control plane. Official JavaScript bindings are native N-API modules for Node, and the browser/Wasm build is relay-only and requires a custom Rust wrapper ([JavaScript bindings](https://docs.iroh.computer/languages/javascript); [browser Wasm](https://docs.iroh.computer/languages/wasm-browser)). Cloudflare Workers documents outbound HTTP/HTTPS and TCP, not arbitrary UDP/QUIC ([Workers protocol support](https://developers.cloudflare.com/workers/reference/protocols/)). The conclusion that a native Iroh endpoint cannot run directly in a Worker or Durable Object is therefore an inference from both vendors' documented runtime constraints. A Cloudflare Container or separate gateway could bridge it, but each is another service and failure boundary.

Use an outbound HTTPS lease loop first. Later, put Iroh entirely inside the runner transport adapter and bridge it to the control plane through an explicitly approved gateway. Iroh's release policy now gives compatibility commitments across minor versions and the previous major, but still calls for regular upgrades ([Iroh release policy](https://docs.iroh.computer/about/release-policy)).

### Additional direct comparison: NVIDIA OpenShell

OpenShell is the one additional self-hostable runner worth retaining in the comparison. It has a gateway, compute drivers, and a sandbox-local supervisor. The supervisor initiates an authenticated outbound connection to the gateway and enforces filesystem, process, network, inference, and credential policy where the workload runs. Docker, Podman, Kubernetes, and microVM drivers share the gateway API ([how OpenShell works](https://docs.nvidia.com/openshell/about/how-it-works); [gateway drivers](https://docs.nvidia.com/openshell/latest/sandboxes/manage-gateways)). The project is [Apache-2.0 licensed](https://github.com/NVIDIA/OpenShell/blob/main/LICENSE) and can be self-hosted.

Its security design is the strongest evaluated reference for Ornn. OpenShell uses Landlock for filesystem restrictions, seccomp and privilege dropping for processes, a policy-controlled proxy for network egress, and an inference gateway that keeps provider API keys outside the sandbox. Its local single-user gateway can use mTLS; shared deployments support stronger identity frontends ([security controls](https://docs.nvidia.com/openshell/latest/security/best-practices); [gateway authentication](https://docs.nvidia.com/openshell/reference/gateway-auth)).

It is not the first implementation for two reasons. First, its gateway owns sandbox state, authorization, settings, provider credentials, sessions, and relay coordination. That substantially overlaps with the control plane Ornn wants to own. Second, the project is still versioned `0.0.x`, so adopting it as the core runner would exchange implementation work for dependency churn. Keep it as a hardening benchmark and prototype it only if the plain-Docker runner cannot meet the threat model. Its inference proxy may become useful if Ornn later adopts API-key model access, but it does not remove the need to validate ChatGPT subscription OAuth behavior.

## Options considered

### A. Codex inside a TanStack-managed sandbox

This is the fastest demo and the weakest match for the initial authentication constraint. TanStack already supplies the Codex harness adapter and Docker/Daytona providers. The isolated sandbox must receive model credentials, and the Codex adapter relaxes the inner Codex sandbox when relying on the outer provider. Choose this only as a disposable spike with a revocable API key, never with the operator's copied long-lived subscription credential.

### B. Pi on the trusted runner, tools through TanStack Docker (selected)

This preserves the key boundaries with the least machinery. The subscription credential stays with the Pi process, the untrusted checkout receives only bounded tool operations, and TanStack shortens the Docker lifecycle and filesystem/process work. The first read-only analysis needs only a small tool set. The main risks are custom glue and Docker hardening. Both are visible and independently testable.

### C. Pi or Codex inside self-hosted Daytona

This has a clean remote runner API, but no longer has a maintained public-source exit from the managed service. Codex retains the credential-placement problem; Pi inside the sandbox does too. Pi outside Daytona with tool routing is sound but adds two abstraction layers before the first slice. Keep it as an optional compatibility adapter, not the second runner proof.

### D. Engine inside OpenShell

This offers the strongest ready-made security controls and credential brokerage for API keys. It is attractive for a security prototype, but its gateway overlaps Ornn's control plane and its early versioning conflicts with the stability preference. Do not make it foundational yet.

### E. Iroh-connected custom runner first

This proves the desired long-term machine attachment too early. Iroh solves reachability, not isolation, scheduling, cleanup, or credential safety, and it cannot terminate in the Cloudflare Worker runtime directly. Preserve the transport seam and add it after the first HTTPS-connected runner works.

## Build-ready first slice

The following sequence should fit in days while producing independently testable capabilities:

1. Define normalized `AgentEvent`, `ResolvedAgentProfile`, `EngineTools`, `SandboxSpec`, `SandboxLease`, and `SandboxRunner` types. Add contract tests with fake engines and runners.
2. Build a trusted runner daemon on a dedicated Linux host. It requests short-lived job leases over authenticated outbound HTTPS, heartbeats them, and rejects work not signed by the Ornn control plane.
3. Wrap TanStack's pinned plain-Docker provider. Create one container per attempt from a digest-pinned image, clone and verify the requested commit inside it, and implement idempotent teardown plus a reaper for expired leases.
4. Harden and self-test the Docker boundary. No host Docker socket, auth directory, SSH agent, cloud credential, or control-plane secret may be reachable from the job container. Enforce CPU, memory, PID, wall-clock, filesystem, and egress limits.
5. Embed Pi in the trusted runner with only Ornn-provided tools. Store Pi's ChatGPT OAuth material outside job workspaces and snapshots. Map Pi events into append-only Ornn job events and redact secrets before emission.
6. Execute one read-only analysis against a pinned GitHub commit. Persist the report and provenance as Ornn artifacts, publish the GitHub comment only from the control plane, then confirm sandbox destruction.
7. Add failure tests: duplicate delivery, runner loss, engine abort, tool timeout, output overflow, failed artifact upload, failed GitHub publication, and failed deletion. Every state must remain inspectable and retry-safe.
8. Add `CodexEngine` as the first replaceability test. Initially permit it only on a trusted development runner or with an explicitly approved credential strategy.
9. Prove capacity replaceability with an OpenShell adapter or a minimal fake remote runner. A Daytona adapter is optional because the maintained implementation no longer has public source. Add Iroh when general user-owned runner enrollment becomes the next goal.

## Acceptance gates

The first real repository flow is not production-ready until all of these are demonstrated:

- Only `bjesuiter` can create a job; runner possession cannot manufacture one.
- A job is tied to a GitHub App installation and immutable repository commit.
- The engine never receives GitHub App credentials, control-plane credentials, or a direct publishing tool.
- The sandbox cannot read the Pi/OpenAI auth store or runner/control-plane secrets.
- Egress is denied except for the minimum allowlist, and denials are observable.
- Cancellation and timeout terminate the process tree and the sandbox; a reaper handles an unreachable control plane.
- Cleanup is verified, not merely requested.
- Provider-native IDs remain opaque metadata and can be replaced without changing job or artifact records.
- Logs, spans, and persisted events identify job, attempt, runner, engine, model, image digest, repository commit, and terminal reason without containing prompts' secret values or credentials.
- The same agent-engine contract passes against a fake runner, and the same runner contract passes without Pi.

## Bottom line

Ornn should begin as a small composition kernel, not as a wrapper around a complete agent platform. **Pi supplies the replaceable reasoning loop. An Ornn adapter over TanStack's Docker provider supplies initial isolated capacity. HTTPS supplies the initial runner link.** Codex should be the next engine adapter. OpenShell is the security benchmark and possible second runner. Iroh follows when NATed personal-machine enrollment matters. Daytona is now only an optional compatibility target because its maintained implementation is private.
