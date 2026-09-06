# Iroh for a Cloudflare Workers Control Plane

Status: research complete

Last verified: 2026-09-06

## Question

Can Ornn Forge's Cloudflare Workers control plane run a persistent Iroh
Endpoint (or an Iroh relay) to remotely control Remote Runners?

## Conclusion

**No—not as a normal Iroh deployment, and it should not be the first
control-plane transport.** A native Iroh Endpoint owns UDP sockets, accepts
QUIC connections, and maintains relay connectivity. Cloudflare Workers expose
outbound TCP only; they do not expose UDP socket binding or inbound direct TCP
connections. A Worker isolate also is not a permanent process in which to keep
an Endpoint and its transport state.

Iroh's browser-Wasm mode does not change that conclusion. It deliberately
uses a relay-only subset because browsers cannot send UDP packets directly;
Iroh documents that mode for browsers, not for Cloudflare Workers. Its
JavaScript binding is N-API over native binaries for Node.js, which likewise
cannot load in workerd. A Worker-specific Iroh custom transport would be a
separate, unstable R&D effort and would not regain direct UDP/NAT traversal.

Use Iroh only on a Remote Runner and a separately operated native **Iroh
Transport Gateway** if a future requirement justifies it. Keep the Worker
control plane on its supported HTTPS and/or Durable-Object WebSocket boundary.
The gateway would translate an Iroh-authenticated control session to an
Ornn-owned HTTPS/WebSocket protocol; it must not become the source of truth
for Runner identity, leases, commands, or audit history.

For the current decision, use an authenticated outbound Durable-Object
WebSocket while preserving the same control-plane protocol and Runner transport
credential. It is an independent transport decision, not an Iroh
implementation.

## Evidence

### Iroh requires an endpoint-hosting runtime

Iroh is a native Rust networking library. Its principal API, `Endpoint`, both
creates outgoing connections and accepts incoming ones. On non-`wasm_browser`
targets, every Endpoint binds IPv4 and attempts IPv6; the underlying UDP
sockets remain alive until all Endpoint clones are dropped. [Iroh Endpoint
API](https://docs.rs/iroh/latest/iroh/endpoint/struct.Endpoint.html#method.bound_sockets)

Iroh's own firewall guidance is explicit: an endpoint listens on one IPv4 and
one IPv6 UDP port for direct P2P connections. With only outbound TCP,
connections fall back to a relay. [Iroh FAQ: ports and
firewalls](https://docs.iroh.computer/about/faq#what-ports-does-iroh-use)
The relay path is itself long-lived: the endpoint opens HTTPS, upgrades it to a
WebSocket, and tunnels QUIC datagrams through that connection. [Iroh on QUIC
multipath](https://www.iroh.computer/blog/iroh-on-QUIC-multipath)

An Endpoint's availability is stateful rather than a per-request operation.
`Endpoint::online` waits until a relay handshake completes, and the Endpoint
continuously monitors network conditions. [Iroh Endpoint
API](https://docs.rs/iroh/latest/iroh/endpoint/struct.Endpoint.html#method.online)
Persisting its secret key is also necessary to preserve the endpoint identity
across restarts. [Iroh chat example](https://docs.iroh.computer/examples/chat)

An Iroh relay is not a Worker-compatible substitute. Iroh documents a
self-hosted relay as a separately deployed relay binary on a public server
with DNS and a publicly reachable IP address. [Iroh relays
concept](https://docs.iroh.computer/concepts/relays)

### Cloudflare Workers do not provide those primitives

Workers' direct socket API creates **outbound TCP** connections. It explicitly
does not support inbound TCP, and its protocol matrix lists no raw UDP or
QUIC socket API. [Workers TCP
sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/),
[Workers supported protocols](https://developers.cloudflare.com/workers/reference/protocols/)
The fact that a zone can accept HTTP/3 does not expose a UDP or QUIC listener
to Worker code.

Workers may run Rust only after compilation to `wasm32-unknown-unknown`, not
as a native process. [Cloudflare Rust on
Workers](https://developers.cloudflare.com/workers/languages/rust/)
The official Iroh JavaScript binding instead targets Node.js through N-API and
ships native binaries; Iroh does not document it as a workerd package. [Iroh JavaScript
binding](https://docs.iroh.computer/languages/javascript)

Workers can hold a TCP connection only within a request/handler and cannot
create it in global scope to share across requests. [Workers TCP-socket
considerations](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#considerations)
Normal Worker isolates can also be evicted; Cloudflare specifically recommends
not depending on mutable global state. [How Workers
work](https://developers.cloudflare.com/workers/reference/how-workers-works/)

Durable Objects help only for the WebSocket alternative, not for Iroh. Their
hibernation API preserves **incoming** WebSocket connections, but not outgoing
ones. An active outgoing TCP or WebSocket can keep an object resident for at
most 15 minutes before it no longer prevents eviction; an Iroh relay session
would therefore still need reconnection and state recovery. [Durable Object
lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/),
[Durable Object WebSocket
guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

### Why Wasm/WebTransport is not an escape hatch

Iroh does compile to Wasm for browser contexts, but its own documentation says
that browser sandboxes cannot send UDP packets directly. Therefore browser
Iroh has no direct connections and routes all traffic through relays; the docs
describe WebTransport and WebRTC only as possible future expansion. [Iroh
WebAssembly and browser limitations](https://docs.iroh.computer/languages/wasm-browser)
Iroh does not claim that this browser build is supported in Cloudflare Workers.

Cloudflare does support Wasm, but it offers the web/runtime APIs available to
the Worker; it does not add browser UDP or a native process/socket interface.
[Cloudflare WebAssembly
runtime](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)
Consequently, compiling Iroh to Wasm would at best require proving an
unsupported relay-only adaptation. It cannot provide the normal Endpoint's
direct Iroh transport or make a Worker an Iroh relay.

Iroh's experimental custom transports do not make this a deployment path. The
feature is explicitly unstable and requires implementing a low-level unreliable
datagram transport; it interoperates only with endpoints that share that
transport. [Iroh custom transports
announcement](https://www.iroh.computer/blog/iroh-0-97-0-custom-transports-and-noq)

## Models considered

| Model | Result | Reason |
| --- | --- | --- |
| Native Iroh Endpoint inside the Worker/DO | Reject | No native binary, UDP bind, or inbound QUIC/TCP listener; eviction conflicts with an endpoint's live socket and relay state. |
| Browser-Wasm Iroh inside the Worker | Reject | Iroh documents browser-specific, relay-only support, not Workers; it removes direct UDP rather than supplying it. |
| Iroh relay inside the Worker | Reject | A relay is a standalone server deployment needing public network ownership; Workers offer HTTP/WebSocket endpoints, not the Iroh relay runtime/network model. |
| Durable-Object WebSocket control channel | Viable later | Supported bidirectional control transport. It needs Ornn protocol-level reconnect, command acknowledgement, and durable desired state; it is not Iroh. |
| Native Iroh Transport Gateway beside the Worker | Defer | Technically compatible with Iroh, but adds a stateful service, gateway protocol, availability and audit requirements. Consider only after polling/WebSocket cannot meet a concrete need. |

## Recommendation for Ornn

Do not change Remote Runner setup, authentication, lease ownership, or
model-credential boundaries to accommodate Iroh. Those remain
control-plane-owned contracts.

If product requirements later require P2P control rather than HTTPS/WebSocket:

1. Write an Ornn transport contract whose messages are durable commands and
   acknowledgements keyed by Runner identity and command ID.
2. Operate the Iroh Endpoint in a dedicated native process with its own
   availability monitoring and persistent Iroh key, outside Cloudflare
   Workers.
3. Have the gateway authenticate to the control plane using a distinct,
   tightly-scoped service credential. A Runner's transport credential must
   authenticate the Runner, not a shared gateway.
4. Preserve D1/R2 as the audit and durable state stores. Losing or restarting
   the gateway must cause reconciliation, never loss of a lease transition or
   remote-control command.

That is a materially larger system than the current Remote Runner and should
be a future research/prototype item rather than a prerequisite for Runner
setup.
