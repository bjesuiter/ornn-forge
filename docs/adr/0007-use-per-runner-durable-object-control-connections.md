# Use per-Runner Durable Object control connections

## Status

Accepted

## Date

2026-09-06

## Context

Remote Runners need prompt, operator-directed control for model reauthentication, local credential revocation, profile refresh, and verified software updates. Pulling static commands only while asking for work delays that control. Iroh was considered, but a normal Iroh Endpoint or relay cannot run in the Cloudflare Workers control plane because it requires native UDP/QUIC socket ownership and persistent endpoint state.

## Decision

Each Remote Runner opens one authenticated, hibernatable WebSocket to a `RunnerConnection` Durable Object selected by its Runner identity. The connection carries the running Runner protocol: leases, lease heartbeats, results, reports, profiles, commands, and acknowledgements. The Runner transport credential authenticates the WebSocket upgrade in headers.

D1 remains authoritative for Runner identities, desired configuration, leases, commands, acknowledgements, and audit history. A Durable Object holds only the current live connection and promptly delivers durable messages. Reconnect starts an explicit synchronization exchange; all commands and leases remain idempotent and recoverable without an in-memory connection.

At most one execution connection may be active for a Runner identity. A verified Runner update may temporarily add one draining old-version connection and one candidate new-version connection; neither can receive leases. This supports rollback without two Runners executing work under one identity.

## Alternatives

### HTTP polling with command responses

- **Pros**: Existing protocol shape; no persistent connection.
- **Cons**: Control is delayed until the Runner polls and makes remote operations awkward.

### Iroh in the Cloudflare Worker

- **Pros**: Desired peer-to-peer transport semantics.
- **Cons**: Workers do not provide Iroh's native UDP/QUIC endpoint or relay runtime. A separate native gateway would add another stateful, availability-critical service.

### One global Durable Object

- **Pros**: One connection coordinator.
- **Cons**: Unnecessary global coordination bottleneck and shared failure domain.

## Consequences

### Positive

- The control plane can push durable commands promptly while Remote Runners keep only outbound connections.
- Durable Object hibernation keeps idle connection cost low.
- The control plane does not gain SSH, arbitrary host execution, or access to Runner-owned model credentials.

### Negative

- The Runner protocol must implement reconnect synchronization, command acknowledgement, lease acceptance, and connection handover explicitly.
- Durable Object connection state must never be treated as the source of truth.
- The future Iroh option requires a separate native transport gateway and a distinct decision.

## Related Decisions

- [0004](./0004-runners-own-model-credentials.md) keeps model credentials on the Runner.
- [Iroh for a Cloudflare Workers Control Plane](../research/iroh-control-plane-cloudflare-workers.md) records the compatibility research.
