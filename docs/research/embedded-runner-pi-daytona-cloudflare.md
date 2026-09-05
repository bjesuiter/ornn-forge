# Embedded Runner with Pi and Daytona on Cloudflare

Status: research complete

Last verified: 2026-09-04

Issue: [#14](https://github.com/bjesuiter/ornn-forge/issues/14)

## Decision

Do not approve the specified production design: one Cloudflare Worker hosting Pi, authenticated with a personal ChatGPT subscription credential, and using the current TanStack Daytona provider for process cancellation and cleanup.

This verdict does not reject subscription authentication on the selected Remote Runner. OpenAI now documents device-code authentication for headless Codex clients, and current Pi source implements that flow. A trusted Remote Runner can therefore start device authorization, let the control plane relay only the verification URL, one-time code, expiry, and completion status, and keep the resulting credential locally. This does not make the same credential suitable for storage inside a Cloudflare Worker.

A smaller proof is technically possible. The modular Pi engine and Daytona client both ran in the repository's Worker runtime, and this preserves the intended split: Pi remains in the trusted Embedded Runner while repository operations go through Ornn's `SandboxDriver` into Daytona. That result is useful, but it does not close the authentication, cancellation, cleanup, capacity, or runtime-duration requirements.

Proceed only after all of these gates are met:

- Use an OpenAI credential intended for trusted non-interactive automation. The documented immediate option is a Platform API key through Pi's API provider. Enterprise Codex access tokens or workload identity could preserve ChatGPT-managed entitlements only after Pi support is proven. Do not copy a personal subscription OAuth session into the Worker.
- Obtain an explicit Pi Worker support commitment, or own a contract suite that covers model discovery, streaming, token refresh, abort, and runtime upgrades.
- Bound a job below the selected Cloudflare invocation limit with enough time left to cancel and verify cleanup, or approve a different runtime.
- Acquire Runner capacity through a durable D1-backed lease before creating a Daytona sandbox. Expiry and reaping must survive Worker restarts and duplicate delivery.
- Bypass TanStack's process `kill()` for cancellation. Use the direct Daytona SDK or REST API to terminate the remote work, then delete the sandbox and poll until deletion is confirmed.
- Pin every direct and transitive integration version exactly. Keep the direct Daytona fallback inside Ornn's TanStack adapter so no Daytona type or lifecycle rule enters the Ornn domain model.

Cloudflare Containers could host the full Node-oriented Pi coding agent later. That adds a service and deployment model which Ornn has not approved, so it is not selected here.

## What the probe observed

These are repository-local probe results, not vendor guarantees.

| Probe | Observed result |
| --- | --- |
| Runtime | Wrangler `4.129.0`, compatibility date `2026-07-10`, `nodejs_compat`, and local workerd |
| Modular Pi | `@earendil-works/pi-agent-core@0.85.0` and `@earendil-works/pi-ai@0.85.0` bundled and executed |
| Provider | The Pi OpenAI Codex provider loaded and reported 7 models |
| Daytona path | `@tanstack/ai-sandbox-daytona@0.3.2`, `@tanstack/ai-sandbox@0.5.0`, and resolved `@daytona/sdk@0.210.0` bundled and executed |
| Bundle | 3,471.20 KiB uploaded, 475.46 KiB gzip |
| HTTP result | `Agent=true`, `provider=openai-codex`, 7 models, and Daytona capabilities including `killableProcesses:false` |
| Pi OAuth | The default lazy loader failed in workerd during `toAuth` with `Cannot read properties of undefined (reading 'endsWith')` |
| OAuth workaround | Calling `registerBunOAuthFlows()` from `@earendil-works/pi-ai/bun-oauth` made `toAuth` work |
| Full coding agent | `@earendil-works/pi-coding-agent@0.85.0` failed Wrangler bundling because imports from `@earendil-works/pi-server` could not be resolved |

The OAuth workaround is not suitable for production. Pi documents the registration hook for a standalone Bun binary, and its implementation statically imports and registers every bundled OAuth flow, not just OpenAI Codex ([lazy loader](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/ai/src/auth/oauth/load.ts), [Bun registration entry point](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/ai/src/bun-oauth.ts)). A successful workaround therefore does not establish supported Worker behavior.

The modular packages are the plausible Worker integration boundary. The failed full package probe rules out treating the current coding-agent package as a drop-in Worker runtime.

## Vendor evidence

### Cloudflare runtime limits

Cloudflare Workers allow 128 MB per isolate. A paid HTTP invocation can use at most 5 minutes of CPU time. Scheduled handlers have a 15-minute wall-time limit. An HTTP handler has no fixed wall-time limit only while its client remains connected, and `ctx.waitUntil()` extends work for at most 30 seconds after the response completes or the client disconnects ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).

Those rules make a client-held HTTP stream a poor owner for a durable job. They also mean a scheduled Embedded Runner must finish the agent session, persist its terminal state, cancel remote work, and verify sandbox deletion within 15 minutes. The bundle fits the paid Worker size limit, but the 128 MB ceiling and startup behavior still need measurement under an actual streamed session.

### Pi compatibility and OAuth

Pi's package metadata declares Node `>=22.19.0`, not Cloudflare Workers ([Pi AI package](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/ai/package.json)). Its agent core supports a stateful agent with caller-supplied model streaming and tools ([agent-core README](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/agent/README.md)). This matches Ornn's intended engine seam, but the successful workerd probe is compatibility evidence, not a support promise.

The failed lazy OAuth load also has a source-level explanation. Pi intentionally hides variable dynamic imports from bundlers so Node-only callback-server and PKCE code does not enter other bundles. The loader assumes `import.meta.url` has `endsWith`, which was not true in the tested workerd bundle ([loader source](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/ai/src/auth/oauth/load.ts)). Ornn should not carry an undocumented runtime patch for renewable credentials.

### OpenAI authentication

OpenAI documents ChatGPT sign-in for a person's local desktop, CLI, and IDE work. It recommends API-key authentication for programmatic Codex CLI workflows such as CI/CD. For trusted non-interactive automation that needs ChatGPT workspace entitlements, it documents Enterprise Codex access tokens and workload identity federation ([Codex authentication](https://developers.openai.com/codex/auth.md)). Pi does not document support for either enterprise mechanism, so they remain candidates rather than validated replacements.

For remote or headless clients, OpenAI also documents device-code authentication and a fallback that transfers the local authentication cache to a trusted machine. Current Pi source implements the device-code exchange directly ([Pi OpenAI Codex OAuth](https://github.com/earendil-works/pi/blob/main/packages/ai/src/auth/oauth/openai-codex.ts)). This is the selected Remote Runner reauthentication path because the Runner obtains and stores its own credential; Ornn will not copy an authentication cache through the control plane.

There is no documented production path here for reusing a personal ChatGPT subscription OAuth session inside a multi-invocation cloud service. Treating Pi's technical ability to obtain or refresh that credential as authorization to operate it on Cloudflare would go beyond OpenAI's documented contract.

### TanStack Daytona behavior

The pinned provider declares `killableProcesses:false` ([Daytona capability declaration](https://github.com/TanStack/ai/blob/22ef5eec4b53719d10b5b249958b3619a9d89824/packages/ai-sandbox-daytona/src/handle.ts#L35-L62)). Its `kill()` aborts only the client-side polling loop; the source states that the remote command is not killed. Later cleanup calls `deleteSession()` and suppresses any error ([Daytona spawn implementation](https://github.com/TanStack/ai/blob/22ef5eec4b53719d10b5b249958b3619a9d89824/packages/ai-sandbox-daytona/src/handle.ts#L375-L437)).

Provider destruction is also too weak for Ornn's contract. It wraps both `daytona.get()` and `daytona.delete()` in one catch-all block, so "already gone" and an authentication, network, or server failure all look like success ([provider, lines 154-161](https://github.com/TanStack/ai/blob/22ef5eec4b53719d10b5b249958b3619a9d89824/packages/ai-sandbox-daytona/src/provider.ts#L154-L161)). Ornn requires cancellation that stops the process tree and cleanup that is verified, not merely requested.

The provider package allows `@daytona/sdk` `^0.191.0`, while this probe resolved `0.210.0` ([provider package metadata](https://github.com/TanStack/ai/blob/22ef5eec4b53719d10b5b249958b3619a9d89824/packages/ai-sandbox-daytona/package.json#L42-L49)). That range is too broad for the ADR's exact-version rule. Add an exact override and record the resolved version in job provenance.

Daytona's `0.210.0` SDK explicitly detects Cloudflare's `WebSocketPair` global and classifies it as a serverless runtime ([runtime detection](https://github.com/daytonaio/clients/blob/f1688d18a3188f107f5bfcb2beef62488fe63777/sdk-typescript/src/utils/Runtime.ts#L98-L109)). This supports the observed bundle result. It does not repair TanStack's cancellation or error handling.

## Architectural fit

The lower-level proof preserves the architecture in `VISION.md` and ADR 0001 if Ornn keeps control:

- The Embedded Runner owns the Pi session, job lease, timeout, events, and terminal decision.
- `PiEngine` receives only job-scoped Ornn tools. Daytona credentials and handles stay inside the Runner's sandbox adapter.
- `TanStackSandboxDriver` may use the provider for ordinary filesystem and execution operations, then use the pinned Daytona SDK or REST client for reliable cancellation and verified deletion.
- Provider IDs remain diagnostic metadata. D1 holds Ornn job and capacity leases, and a reaper can resume cleanup without an in-memory Worker session.
- The same `AgentEngine`, Runner, and `SandboxDriver` contract tests must pass for the Remote Runner on `homeserv1` and this Embedded Runner.

This is a bounded replacement proof, not a reason to make Daytona or Cloudflare runtime semantics part of the job model.

## Recommended next proof

Build a non-production contract probe with an approved automation credential and exact package pins. Run one short, read-only Pi session through the Ornn adapter. Force cancellation during a long Daytona command, verify server-side termination through the direct SDK or REST path, delete the sandbox, and poll until it no longer exists. Repeat across Worker restart and duplicate-delivery cases using a D1 capacity lease.

Approval depends on those tests, a measured memory profile, and an execution deadline that always leaves cleanup margin. Until then, keep the Remote Runner on `homeserv1` as the selected first path from the foundation research.
