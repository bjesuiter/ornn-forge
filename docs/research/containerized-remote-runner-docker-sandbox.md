# Local Runner Test Harness with Docker sandboxes

Status: research complete

Last verified: 2026-09-06

Issue: [#30](https://github.com/bjesuiter/ornn-forge/issues/30)

## Scope and decision

Use a disposable **local test/debug Runner** as a digest-pinned
Debian-and-Bun application container. It runs on the developer's selected
local Docker Engine—OrbStack on macOS or Docker Engine on Linux (`srv04`)—and
creates each Job sandbox as a sibling container on that Engine. The Runner is
packaged in a container; its Job sandboxes are not nested inside it. This lets
the developer edit the Runner source on the same machine without installing
Bun or the Runner on that host.

This is a development integration-test harness, not a production deployment
decision. Its purpose is to exercise the Runner, its Docker adapter, and
crash/cleanup behavior against a real local Engine while keeping the host free
of Runner dependencies. It does not prescribe how a production Remote Runner
is installed or operated, including on `homeserv1`.

For this local harness, host-Engine socket passthrough is the least-complex
viable model for the existing Docker
`SandboxDriver` contract. It lets a restarted Runner discover, inspect, stop,
remove, and verify the exact local-Engine resources that it created. It does
**not** make the Runner a lower-trust workload: Docker documents that members
of the `docker` group receive root-level privileges, and that a daemon
controller can create a container which mounts the host root filesystem.
Treat the Runner image, its dependencies, and every process with socket access
as host-trusted.  [Docker post-install security](https://docs.docker.com/engine/install/linux-postinstall/),
[Docker daemon attack surface](https://docs.docker.com/engine/security/)

Do not mount the socket, Runner state, Runner credentials, a host workspace,
or any host bind mount into a Job sandbox.  The Docker adapter, rather than
agent-provided input, owns every Job-container creation option.

## Models considered

| Model | Result | Reason |
| --- | --- | --- |
| Host-Engine Unix-socket passthrough | **Select** | A normal Unix-socket Engine API client can create and reconcile sibling Job containers without a Docker daemon in the Runner image. The local socket is Docker's default control path; the API supports version negotiation. [Protect Docker daemon socket](https://docs.docker.com/engine/security/protect-access/), [Engine API](https://docs.docker.com/reference/api/engine/) |
| Docker-in-Docker (DinD) | Reject | Docker documents `--privileged` as the broad privilege mode needed for cases such as Docker-in-Docker. It grants all capabilities and host devices. The nested daemon also creates a second storage, cgroup, network, image, and cleanup domain that the existing adapter would have to recover separately. [Runtime privileges](https://docs.docker.com/engine/containers/run/), [Moby DinD guidance](https://github.com/moby/moby/wiki/Docker-in-Docker) |
| Rootless DinD | Reject for v1 | Docker's documented rootless-DinD invocation still uses `--privileged` to relax seccomp, AppArmor, and mount restrictions. That retains the unwanted Runner privilege boundary while adding an inner daemon. [Rootless Docker tips](https://docs.docker.com/engine/security/rootless/tips/) |
| Rootless host Engine plus its socket | Defer as a hardening experiment | Rootless Docker can run daemon and containers in a user namespace, but requires `uidmap` and at least 65,536 subordinate UIDs/GIDs. Resource limits rely on cgroup v2 and systemd; otherwise CPU, memory, and PID flags may be ignored. Prove those controls on the local Linux target before adopting it, because ADR 0005 requires an enforceable resource policy. [Rootless mode](https://docs.docker.com/engine/security/rootless/), [rootless limitations](https://docs.docker.com/engine/security/rootless/tips/) |

The selected model is only "least privileged" at the Linux-container level:
the Runner can use a non-root UID, drop Linux capabilities, and avoid host
network/PID namespaces.  It is not least authority with respect to Docker. A
compromised Runner can use the host daemon beyond Ornn policy, so its real
security boundary is the same trusted-Runner boundary already assumed by ADR
0004. The local debugging profile is not a `homeserv1` deployment design and
does not authorize deploying this image or its local credential arrangement to
that host.

## Test-harness contract

### Image and runtime

Build a small, multi-stage image from a pinned `oven/bun:<version>-debian`
digest. Its runtime stage needs only the built Runner, Bun, CA certificates,
and a minimal init such as `tini`; it does not need a Docker daemon or Docker
CLI when the adapter speaks the Engine API. Pin both the base image digest and
application lockfile, and pre-pull each approved Job-sandbox image digest at
Runner readiness rather than on Job creation. Publish `linux/amd64` and
`linux/arm64` variants under one immutable manifest-list digest, or build the
native variant locally. Docker selects the matching manifest variant when it
pulls a multi-platform image; OrbStack supports both architectures on Apple
Silicon, but forcing `amd64` adds emulation and is not the portable default.
[Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/),
[OrbStack Docker containers](https://docs.orbstack.dev/docker/)

Run one Runner container with all of the following invariants:

- on native Linux, use a fixed non-root UID/GID and add only the numeric group
  owning the Docker socket so that the process can connect. Do not assume that
  this group mapping works on OrbStack: its public documentation promises a
  forwarded socket but does not specify its in-container ownership mapping,
  and OrbStack has a tracked report of a non-root container being denied socket
  access despite `--group-add root`. The macOS launcher must test `/_ping` as
  the intended Runner UID. If it fails, its explicit developer-only fallback
  is `user: root` for the Runner with no added capabilities; it must not be
  silently used on Linux or treated as a production configuration. Socket
  access already gives the Runner effective daemon/host authority, but this
  fallback gives up the remaining in-container UID defense. [OrbStack socket
  permission report](https://github.com/orbstack/orbstack/issues/1673),
  [Docker post-install security](https://docs.docker.com/engine/install/linux-postinstall/)
- no `--privileged`, no added capabilities, no host PID/network namespace, and
  `no-new-privileges`; use a read-only root filesystem plus small `tmpfs`
  mounts where the dependencies permit it;
- one Docker-managed named volume mounted only at
  `/var/lib/ornn-runner` for the encrypted credential ciphertext, recovery
  ledger, and bounded cache; volumes persist independently of a replaced
  Runner container. [Docker volumes](https://docs.docker.com/engine/storage/volumes/)
- bind the selected local Engine's Unix socket to a fixed path such as
  `/var/run/docker.sock` inside the Runner and set its Engine client to that
  in-container path. Do not expose Docker TCP. Docker recommends SSH or
  mutually authenticated TLS when remote access is needed. [Protect Docker
  daemon socket](https://docs.docker.com/engine/security/protect-access/)
- for the local debugging profile only, bind the checked-out Ornn source into
  the **trusted Runner** for a watch/restart loop and bind separately managed
  development credential files read-only. These are explicit exceptions to the
  production-oriented "socket only" mount shape. They never enter a Job
  sandbox, and the credential must be a separate development registration,
  never a production or `homeserv1` secret.
- provide a `debug` image target that runs the mounted source with Bun watch
  support (or restart it explicitly), keeping any dependency cache in the
  image or a Runner-only volume. The source mount must not rely on a host Bun
  or host `node_modules` directory.

A read-only socket bind does not limit Docker API operations; Unix-socket
permissions determine access. The configuration must therefore not describe
the socket mount as a security boundary.

Docker bind mounts are writable by default and reference paths on the daemon
host, not on the API client. The adapter must reject every Job request that
asks for a host bind mount. In particular, the Runner's source mount at (for
example) `/workspace/ornn-forge` is not a path that may be forwarded to the
Engine for a child sandbox. Use the Docker archive/file API or an anonymous
workspace volume for every Job checkout. [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)

### Test state and credentials

Use a separate, untracked development Runner registration and transport
credential, mounted read-only only into the Runner. The harness may use a
fixture executor and does not need a model OAuth credential for its core
Docker-adapter tests. If a local model-authentication experiment is needed,
its encrypted mutable OAuth record belongs in the Runner-only named volume;
it is never passed through an environment variable, command line, image, or
Job sandbox. This test harness neither replaces nor changes ADR 0004's
production credential decision.

Do not use image build arguments or environment variables for secrets: Docker
documents that they persist in the final image or its metadata. [Docker build
secrets](https://docs.docker.com/build/building/secrets/)

The named volume contains durable Runner state only. A Job receives a fresh
anonymous workspace volume (if its writable layer is not used), labeled and
recorded with the Job identity. Docker retains anonymous volumes after a
container is removed unless removal includes volumes, so cleanup must handle
them explicitly. [Volume lifecycle](https://docs.docker.com/engine/storage/volumes/)

### Job sandbox policy and cleanup

The test harness must preserve, rather than change, ADR 0003 and ADR 0005:

1. Before create, persist the capacity reservation and a `provisioning` ledger
   record. Create a deterministic container name and immutable ownership,
   generation, and specification-fingerprint labels. Docker supports labels
   and label filters for discovery. [Docker labels](https://docs.docker.com/engine/manage-resources/labels/)
2. Create one fresh sandbox with `network=none`, no published ports, no Docker
   socket, no host mounts, no Runner volume, `restart=no`, `init=true`, the
   approved resource controls, and a digest-pinned image. Import a
   credential-free checkout through the Docker archive/file API or an
   anonymous workspace volume; never share a host checkout.
3. Persist the full container ID and every anonymous-volume ID before marking
   the sandbox ready. A new Runner process discovers only the expected labels,
   then adopts the exact matching resource or quarantines an ambiguity.
4. On cancellation, fence new work, stop the **container** with five seconds
   of grace, then force-remove it when needed. Docker's stop operation sends
   the configured stop signal and escalates to `SIGKILL` after its timeout.
   [Docker stop](https://docs.docker.com/reference/cli/docker/container/stop/)
5. Remove the exact container and recorded anonymous volumes. Inspect the
   exact IDs and repeat label discovery afterwards. Mark cleanup `verified`
   only when Docker is reachable and both checks prove absence. A socket error,
   timeout, or successful remove response alone is not proof. Never run a
   broad `docker container prune`: it removes all stopped containers. [Docker
   container prune](https://docs.docker.com/reference/cli/docker/container/prune/)

This retains an unverified sandbox's capacity reservation and lets the cleanup
reaper continue, exactly as ADR 0003 requires. Job success and cleanup success
remain distinct facts.

## Local developer runbook

This is a reproducible local debugging path, not a `homeserv1` deployment and
not a request to expose a Docker daemon remotely. Implement it as a small
host-side launcher plus a portable Compose file; the launcher is responsible
for resolving local paths and validating the selected context before Compose
starts anything.

1. Start OrbStack on macOS and select `docker context use orbstack`, or start
   the local Docker Engine on Linux and select its local context. Confirm the
   active context and inspect its Docker endpoint. Docker contexts expose the
   endpoint through `docker context inspect`; the launcher accepts only a
   reachable `unix://` endpoint and rejects SSH and TCP endpoints. OrbStack
   creates an `orbstack` context and forwards its Engine socket to macOS; its
   `/var/run/docker.sock` compatibility symlink exists only when the user gave
   OrbStack administrator access. Therefore the launcher must discover and
   validate the active Unix-socket path instead of assuming that symlink.
   It also probes that socket as the configured non-root Runner user. On
   OrbStack only, a documented, opt-in root-user fallback is permitted when
   the platform's socket ownership mapping prevents that probe; it remains a
   developer-local exception, not a portable default.
   [Docker contexts](https://docs.docker.com/engine/manage-resources/contexts/),
   [OrbStack Docker socket](https://docs.orbstack.dev/docker/),
   [OrbStack architecture](https://docs.orbstack.dev/architecture)
2. The launcher resolves the repository with `pwd -P`, confirms that it is
   the Ornn Forge checkout, and exports its absolute path and the discovered
   socket path as Compose interpolation inputs. The committed Compose file
   uses a relative build context and long-form bind mounts with
   `create_host_path: false`; that makes a missing source fail instead of
   silently creating an empty directory. Compose supports required variable
   interpolation, and relative build contexts preserve portability. [Compose
   interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/),
   [Compose services](https://docs.docker.com/reference/compose-file/services/),
   [Compose build](https://docs.docker.com/reference/compose-file/build/)
3. Compose mounts (a) the discovered socket at the Runner's fixed socket path,
   (b) a project-scoped named `ornn-runner-state` volume, (c) the local Ornn
   checkout only into the Runner for live edit/restart, and (d) the two
   untracked development credential files read-only. It starts the Runner from
   the container image; the host needs Docker/OrbStack and the checkout, but
   no host Bun or Runner installation. The Job Docker policy remains unchanged:
   no host checkout, Docker socket, Runner state, or credential mount in any
   sandbox.
4. Require readiness before advertising local capacity: the state volume is
   writable; the encrypted credential store validates; the development Runner
   authenticates; Engine `/_ping` and API-version negotiation succeed; required
   sandbox-image digests are present; and no owned resource is quarantined.
   Use a container `HEALTHCHECK` for liveness/readiness state, which Docker
   records for inspection. [Dockerfile HEALTHCHECK](https://docs.docker.com/reference/dockerfile/#healthcheck)
5. Edit the mounted Runner source and restart or use the image's watch mode.
   Restart testing must retain the project-scoped state volume so the new
   Runner reconciles the existing ledger and sibling sandboxes. On macOS,
   OrbStack bind mounts expose Mac files to containers through VirtioFS, while
   named volumes live on the Linux side and are faster; keep only the active
   source checkout as a bind mount and use volumes for Runner state and caches.
   [OrbStack volumes and mounts](https://docs.orbstack.dev/docker/file-sharing/)
6. To discard a local run, first drain or quarantine its exact Job containers
   and let the Runner verify cleanup. Then stop the Compose project. Retain
   the named volume for recovery testing; remove that named volume only for an
   intentional fresh development identity/state reset. Never use broad Docker
   prune commands, since they can remove unrelated local work.

## Proof-of-concept plan

Run each check against two disposable local targets: macOS with OrbStack and
the native Linux Docker Engine on `srv04`. Do not use production credentials;
use a separate development control-plane registration and a canary value to
prove non-disclosure.

1. From an Ornn Forge checkout, use the local launcher to discover the active
   Unix socket and start the Debian+Bun image with the runbook's mounts and
   restrictions. Assert that the Runner has no Docker daemon, host
   network/PID namespace, or host directories beyond its explicit source and
   development-credential mounts. Assert that the source mount is present in
   the Runner and an edit/restart takes effect without a host Bun or Runner
   install. On both targets, prove `/_ping` as the configured Runner UID;
   record use of the OrbStack-only root fallback if that platform's socket
   mapping prevents non-root access.
2. Through the Runner's Docker adapter, create a fixture Job sandbox. Verify
   its deterministic name and labels, `network=none`, `restart=no`, resource
   settings, absence of socket/host/Runner mounts, and a credential-free
   workspace.
3. Execute a fixture command, collect an artifact, cancel another long-running
   fixture, and demonstrate whole-container termination. Remove each exact
   container and anonymous volume; prove both exact-ID inspection and
   ownership-label discovery report absence.
4. Kill the Runner container after each create, execute, collect, terminate,
   and destroy checkpoint. Restart it from the same project-scoped state
   volume. It must
   adopt only an exact matching resource, quarantine a mismatch, and never
   release capacity merely because its previous process exited.
5. Test unavailable Docker and a denied socket. In both cases, cleanup remains
   pending or failed and capacity remains reserved; neither path may report
   verified deletion. Test that a Job cannot read the Runner state, activation
   credentials, Docker socket, or a different Job's workspace.
6. Exercise an image-digest update and rollback after a clean drain. Confirm
   that the development Runner's credential record persists and that its
   plaintext never appears in the image, container inspection, environment,
   logs, labels, artifacts, or Job filesystem. On Apple Silicon, test the
   native `linux/arm64` image; test `linux/amd64` only as the optional emulated
   compatibility case. On Linux, test the host-native image variant.

## ADR impact

No change to the decisions in ADR 0003 or ADR 0005 is required: the test
harness preserves their independent cleanup state, deterministic identity,
discovery, whole-container termination, and verified deletion rules.

ADR 0004's trust boundary remains valid: the local development store key and
transport credential are read-only Runner-only mounts, and no sandbox receives
them. Its `homeserv1` systemd credential-delivery decision remains untouched;
this note deliberately does not specify a container deployment for that host.
The later production deployment may make a separate choice about a host
`StateDirectory=` or Docker named volume, but it must retain ADR 0004's
no-sandbox-mount rule.

Moving to a rootless host Engine is a later, separately approved hardening
decision after a local Linux proof establishes user-namespace operation,
cgroup-v2 resource enforcement, and recovery/cleanup parity. It is not an
ADR prerequisite for this debugging environment.
