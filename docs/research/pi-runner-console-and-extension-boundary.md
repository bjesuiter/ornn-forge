# Pi as a Runner console or Runner host

Status: research complete  
Last verified: 2026-09-10  
Pi revision reviewed: [`400d6905ce46ec46e79da8a7701b1b48850192df`](https://github.com/earendil-works/pi/tree/400d6905ce46ec46e79da8a7701b1b48850192df), package version `0.85.1`
Issue: [#65](https://github.com/bjesuiter/ornn-forge/issues/65)

## Recommendation

Add a Pi-powered console for each Remote Runner only as an optional operator interface. Preserve the conversation across messages, but start by restoring Pi on demand and stopping it when idle. Keep a permanently running Pi process only if measured startup latency makes it worthwhile. Do not make the console the Runner, its command authority, or its durable state.

The useful version of the idea is a conversational console that can inspect one Runner, explain its state, and propose operations. Every mutation still crosses an Ornn-owned authorization gate and becomes a durable Runner command. D1 and the Runner command journal stay authoritative. A lost or confused console session must not affect Job execution, synchronization, cancellation, cleanup, or updates.

Keep exactly one fresh Pi session per Job. The console is a different thing. It cannot enumerate, resume, prompt, or read a Job's Pi session. This preserves the current isolation rule in [the vision](../../VISION.md#reliable-isolated-jobs) and [the first Analyze Flow route](../plans/first-analyze-flow-implementation-route.md#slice-5-run-pi-without-exposing-its-credential). Calling both things a "session" will invite mistakes, so an implementation should give the new concept an explicit domain name such as `Runner console` before adding protocol types.

Do not move the Runner into a stable Pi extension. It would save one top-level process at most while joining the Runner's failure, security, session-reload, and update lifecycle to the agent engine. That is not a slimmer architecture in the places where Ornn needs reliability.

Pi's experimental server and plugin work is much closer to the extreme proposal. It has a server, one worker per Session, typed RPC services, replicated state, and separate Session and TUI plugin facets. Pi still labels that harness development-only, excludes its commands and implementation from npm packages and standalone binaries, and lists authenticated client projections and workspace authorization as future work. Treat it as a design signal and later prototype target, not an Ornn dependency today. [Pi development notes](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/docs/development.md), [experimental service status](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/src/experimental/services/README.md)

## The distinction that matters

Herdr keeps terminal processes in a background server and lets a client reconnect locally or through SSH. Its socket API controls terminal panes and recognized agent processes. Its Pi integration is a Pi extension that reports lifecycle and session identity back to Herdr. That makes Herdr a process and terminal supervisor around Pi. [Herdr remote model](https://github.com/herdrdev/herdr/blob/120c682008a85dc17d7a13cc619a2fd5d25f3924/docs/next/website/src/content/docs/persistence-remote.mdx), [Herdr socket API](https://github.com/herdrdev/herdr/blob/120c682008a85dc17d7a13cc619a2fd5d25f3924/docs/next/website/src/content/docs/socket-api.mdx), [Herdr Pi integration](https://github.com/herdrdev/herdr/blob/120c682008a85dc17d7a13cc619a2fd5d25f3924/docs/next/website/src/content/docs/integrations.mdx#pi)

Ornn's Remote Runner already has a different job. It accepts exclusive Job leases, enforces Runner capacity, owns model credentials, creates and destroys sandboxes, journals commands, reconciles after restart, and reports durable outcomes. A terminal multiplexer is unnecessary for those duties. Removing Herdr from that deployment is reasonable.

Replacing the Runner with a conversation is not. A model response is probabilistic and can be delayed, compacted, steered, aborted, or influenced by untrusted text. Runner commands need typed targets, idempotency keys, expected state, durable acknowledgement, and replay after disconnection. Those are different contracts.

The proposed shape should be:

```text
mobile Ornn dashboard
        |
        | authenticated Operator actions and console messages
        v
Cloudflare control plane ---- D1 authority
        |
        | existing per-Runner Durable Object WebSocket
        v
Remote Runner service
        |                         |
        |                         +-- optional Runner console
        |                             one restricted Pi session
        |
        +-- Job A: fresh Pi session -> Job A sandbox
        +-- Job B: fresh Pi session -> Job B sandbox
```

The console can use Ornn tools such as `inspect_runner`, `list_recent_jobs`, `explain_fault`, and `request_runner_pause`. The first three read sanitized Ornn projections. The last one submits a structured proposal to the control plane. The control plane authenticates the Operator, checks policy and current revision, writes the Runner command, and then delivers it through the existing protocol. The model never sends a privileged wire message directly.

This preserves a useful invariant: disconnecting or deleting the console changes no Runner desired configuration and loses no accepted Runner command.

## What stable Pi can provide

Pi's SDK can create an `AgentSession`, subscribe to streamed lifecycle and tool events, prompt it, queue steering or follow-up input, abort it, compact it, and dispose it. The caller can replace the built-in tools with an explicit set of custom tools. That is enough to embed a restricted console in the current Runner process without spawning a TUI. [Pi SDK](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/docs/sdk.md)

Pi persists conversations as JSONL session trees and can continue, open, fork, clone, and compact them. This is useful operator context, but it is conversation history rather than a transactional command journal. [Pi sessions](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/docs/sessions.md), [session format](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/docs/session-format.md)

Pi's stable RPC mode is strict JSONL over the child process's stdin and stdout. It supports prompt, steer, follow-up, abort, state inspection, session switching, and extension UI requests. It is an embedding protocol, not a network listener or authenticated remote service. A mobile client still needs an authenticated Ornn UI and transport to reach the Runner. [Pi RPC mode](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/docs/rpc.md)

The embedded SDK is the better first experiment. It avoids supervising a second process and gives Ornn direct control over resource loading, tools, credentials, events, cancellation, and session storage. RPC remains a useful replacement proof because it tests the same console adapter across a process boundary.

## What a stable Pi extension can provide

A Pi extension can register tools and commands, observe or intercept lifecycle and tool events, inject messages, append persistent custom entries, open sockets or file watchers after `session_start`, and clean them up at `session_shutdown`. Extensions can also hot reload. Session replacement and reload tear down the old extension runtime and require it to rebuild in-memory state. Extension errors are generally logged while Pi continues; a tool interception error blocks that tool. [Pi extensions](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/docs/extensions.md)

That API can host a small Ornn console adapter. It is a poor owner for the Remote Runner:

- Pi tells extensions to defer background resources until a session starts and close session-scoped resources on session shutdown. The Runner connection and cleanup reaper belong to the Runner identity, not one conversation's lifecycle.
- Switching, forking, creating a session, or reloading replaces the extension instance. The command journal, active leases, and sandbox reconciliation cannot follow that lifecycle.
- Extension failures do not stop Pi by default. Ornn would need another health and supervision layer to know whether the supposed Runner still works.
- Extensions run with the full permissions of the Pi process and may execute arbitrary code. Putting Runner credentials, Docker control, and the model credential in that process makes every loaded extension part of the trusted computing base. [Pi extension security](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/docs/extensions.md#extension-locations), [Pi security model](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/docs/security.md)

If Ornn ever ships a console extension, construct Pi with an Ornn-owned `ResourceLoader`, disable default discovery, and load only the pinned extension factory. Never let a repository add a console tool or extension.

## Pi's experimental server and plugin direction

The experimental harness proves that Pi's maintainers are exploring the same split. Its server exposes Session management, starts a worker for a Session, and gives presentations typed `AgentController` and replicated `Transcript` services. The controller has structured prompt, abort, steer, follow-up, resume, compaction, and navigation methods. [service layout](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/src/experimental/services/README.md), [AgentController contract](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/src/experimental/services/agent-controller.ts)

Its plugin packages can contribute separate Session-worker and TUI facets. Pi builds them into server-owned plugin artifacts, associates the selection with one Session, and can reload a generation while other Sessions remain unaffected. [example plugin](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/examples/plugins/pi-example-plugin/README.md), [example Session facet](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/examples/plugins/pi-example-plugin/src/session.ts)

The harness has local Unix transport and an experimental authenticated Radius relay over outbound WebSockets. The non-interactive client can connect to a server, attach to a Session, call the agent service, and subscribe to the transcript. [client runtime](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/src/experimental/client-runtime.ts), [Radius relay](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/src/experimental/radius-relay.ts)

This could eventually support a Pi-native remote console. It cannot replace Ornn's current Runner connection now:

- Pi excludes the server, client, plugin package API, and their dependencies from published packages and standalone binaries.
- The service status explicitly leaves authenticated per-client projection and workspace authorization unfinished.
- The current presentation is a terminal UI, so it does not solve the narrow mobile experience by itself.
- Its Session and service types would become another control model if Ornn used them for Job leases or Runner commands.

The right revisit condition is a published, versioned plugin and remote-service API with an authorization model that can pass Ornn-owned contract tests. Even then, use it behind the `AgentEngine` or console adapter. Do not import Pi Session identity into Ornn's Job or Runner identity.

## Option comparison

| Option | What becomes simpler | What gets worse | Verdict |
| --- | --- | --- | --- |
| Keep only deterministic dashboard controls | No extra model session, context, cost, or new trust path | Diagnosis remains a set of fixed screens and commands | Required baseline |
| Add a restricted, on-demand Pi Runner console beside the Runner | Natural-language inspection and control from the Ornn dashboard; no Herdr dependency | One more model conversation, transcript, quota, and authorization adapter | Recommended experiment |
| Run that console as a Pi RPC child | Stronger process boundary and an independent replacement proof | Process supervision, JSONL framing, restart and credential plumbing | Good second adapter |
| Put the Runner in a stable Pi extension | One top-level process and one package entrypoint | Runner lifetime follows a conversation; larger trusted code set; reload and update coupling | Reject |
| Put the Runner in an experimental Pi Session plugin | Aligns with Pi's emerging server and service model | Unpublished API, incomplete authorization, competing durable state and identity | Watch, do not adopt |
| Connect mobile directly to Pi | Bypasses control-plane UI work | Still needs remote transport, authentication, audit, reconnect, and policy; splits authority | Reject |

## ADR fit and conflicts

### ADR 0001

[ADR 0001](../adr/0001-ornn-owns-the-job-model.md) allows Pi behind an adapter. The restricted console fits if its transcript and Pi session ID remain diagnostic or presentation state. Moving leases, commands, Job state, capability policy, or artifacts into Pi Session services conflicts with the ADR. Making the Runner a Pi plugin is acceptable only as packaging if all Ornn contracts remain unchanged. In that case it saves little.

### ADR 0004

[ADR 0004](../adr/0004-runners-own-model-credentials.md) remains intact when the console uses the Runner's injected `CredentialStore` and no credential crosses the control connection. A general Pi process with auto-discovered extensions would weaken the intended boundary because every extension has the process's permissions. The console must load only operator-pinned code and must not expose authentication tools or raw provider errors.

### ADR 0005

[ADR 0005](../adr/0005-keep-the-sandbox-driver-generic.md) rules out exposing Pi Session or plugin types through `SandboxDriver`. Console tools may inspect Ornn sandbox observations, but only the Runner calls the driver. A Pi plugin that directly owns Docker, GitHub, or provider handles would collapse the seam and conflict with this ADR.

### ADR 0007

[ADR 0007](../adr/0007-use-per-runner-durable-object-control-connections.md) is the strongest constraint. Replacing the Runner control connection with direct Pi RPC, Radius, SSH, or a plugin socket conflicts with the accepted decision. Sending console messages over the existing connection does not conflict, provided D1 remains authoritative and console-triggered mutations become ordinary durable Runner commands with acknowledgements.

### Current no-shared-session scope

The current plan explicitly disables shared Pi sessions and gives every Job a fresh one. A single console that can enter Job context, resume a Job's session, or act as the common agent for several Jobs would conflict with that plan. A separate console can coexist if its tools expose only sanitized Ornn records and command requests. It is not a Job group and cannot exchange hidden context between Jobs.

## Failure, security, and update boundaries

The console should fail open for Job execution and fail closed for control. If its model, context, credential, transcript, or tool adapter fails, the Runner continues existing Jobs and refuses console mutations. The dashboard's deterministic controls remain available.

Console persistence is for continuity only. After a restart, Ornn may reopen its Pi JSONL conversation or start a fresh one. It reconstructs Runner status from D1 and a synchronized Runner report, never from the old transcript. An accepted command survives because it is in D1 and the command journal. A sentence such as "I paused the Runner" proves nothing.

Treat every Job artifact, log excerpt, repository string, and provider error shown to the console as untrusted input. Read tools should return bounded structured data with provenance. Mutation tools should accept fixed schemas, exact Runner and Job IDs, expected revisions, and idempotency keys. Do not give the console shell, arbitrary HTTP, Docker, filesystem, credential, package-install, update, or raw Runner-protocol tools.

Do not let the console consume Job capacity silently. Give it a separate concurrency and spend limit, and disable it when the Runner's model credential is unhealthy. The Runner's readiness report must distinguish console availability from Job capacity.

Package the console adapter in an immutable Runner release. Pi upgrades and console prompt or tool changes should follow the Runner release and update handover. Never let the console update its own extension or call Pi's package installer. Pi extension reload replaces extension runtime state, which is another reason the Runner service must remain outside it. [Pi reload lifecycle](https://github.com/earendil-works/pi/blob/400d6905ce46ec46e79da8a7701b1b48850192df/packages/coding-agent/docs/extensions.md#ctxreload)

## Small migration experiment

Run this after the current Remote Runner synchronization and command journal are stable. It should not block the first Analyze Flow.

1. Add an SDK-backed console adapter inside a non-production Runner. Give it one persisted Pi conversation that the Runner restores on demand, plus four read-only tools: inspect Runner synchronization, inspect desired configuration, list recent Jobs, and explain one sanitized fault. Load no built-in tools, project resources, or discovered extensions. Stop the console after an idle timeout and measure restore latency before considering an always-running process.
2. Add an authenticated dashboard conversation view. Persist Operator messages and rendered console replies separately from Job events. Carry them over the existing per-Runner control connection. Do not add a direct browser-to-Runner route.
3. Restart the dashboard, Durable Object, Runner, and console independently. Prove that the console reconstructs every answer from D1 and current Runner observations. Delete its Pi session file and prove that Runner behavior and accepted commands do not change.
4. Add one reversible mutation, `request_runner_pause`. The console tool submits a proposal. The dashboard shows the exact structured command for confirmation. The control plane creates the normal durable Runner command only after confirmation.
5. Duplicate, reorder, and disconnect every message around that pause. Prove one command ID, one journal outcome, and the same desired configuration after reconnect. Inject a misleading Job log that tells the console to cancel another Job and prove no mutation occurs.
6. Implement the same read-only console adapter through Pi's stable RPC subprocess. Compare restart behavior, memory, latency, packaging, and failure isolation with the SDK version.

The experiment passes only if:

- stopping or corrupting the console does not interrupt Jobs, synchronization, cleanup, reauthentication, or Runner updates;
- no console transcript or Pi identifier becomes authoritative domain state;
- no console tool can access a Job Pi session, sandbox handle, model credential, or host shell;
- every mutation appears as an Operator-authorized Ornn Runner command and survives reconnect through existing synchronization;
- the mobile view remains useful when the model is unavailable because deterministic Runner controls still work.

If those checks pass, keep the hybrid. If the chat adds little beyond status cards and fixed actions, remove it. The dashboard is the product boundary either way. Pi is a good conversational component inside that boundary, not a replacement for it.
