# Containerized Remote Runner with Docker sandboxes

Status: research complete

Last verified: 2026-09-06

Issue: [#30](https://github.com/bjesuiter/ornn-forge/issues/30)

## Decision

Run the first `homeserv1` Remote Runner as a digest-pinned Debian-and-Bun
application container.  Give that trusted Runner access to the **host** Docker
Engine through its Unix socket, and create each Job sandbox as a sibling
container on that Engine.  The Runner is packaged in a container; its Job
sandboxes are not nested inside it.

This is the least-complex viable design for the existing Docker
`SandboxDriver` contract.  It lets a restarted Runner discover, inspect, stop,
remove, and verify the exact host-Engine resources that it created.  It does
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
| Rootless host Engine plus its socket | Defer as a hardening experiment | Rootless Docker can run daemon and containers in a user namespace, but requires `uidmap` and at least 65,536 subordinate UIDs/GIDs. Resource limits rely on cgroup v2 and systemd; otherwise CPU, memory, and PID flags may be ignored. Prove those controls on `homeserv1` before adopting it, because ADR 0005 requires an enforceable resource policy. [Rootless mode](https://docs.docker.com/engine/security/rootless/), [rootless limitations](https://docs.docker.com/engine/security/rootless/tips/) |

The selected model is only "least privileged" at the Linux-container level:
the Runner can use a non-root UID, drop Linux capabilities, and avoid host
network/PID namespaces.  It is not least authority with respect to Docker. A
compromised Runner can use the host daemon beyond Ornn policy, so its real
security boundary is the same trusted-Runner boundary already assumed by ADR
0004.

## Deployment contract

### Image and runtime

Build a small, multi-stage image from a pinned `oven/bun:<version>-debian`
digest. Its runtime stage needs only the built Runner, Bun, CA certificates,
and a minimal init such as `tini`; it does not need a Docker daemon or Docker
CLI when the adapter speaks the Engine API. Pin both the base image digest and
application lockfile, and pre-pull each approved Job-sandbox image digest at
Runner readiness rather than on Job creation.

Run one Runner container with all of the following invariants:

- fixed non-root UID/GID; add only the numeric group owning the host Docker
  socket so that the process can connect;
- no `--privileged`, no added capabilities, no host PID/network namespace, and
  `no-new-privileges`; use a read-only root filesystem plus small `tmpfs`
  mounts where the dependencies permit it;
- one Docker-managed named volume mounted only at
  `/var/lib/ornn-runner` for the encrypted credential ciphertext, recovery
  ledger, and bounded cache; volumes persist independently of a replaced
  Runner container. [Docker volumes](https://docs.docker.com/engine/storage/volumes/)
- the host Unix socket as the sole host bind mount used for Docker control;
  do not expose Docker TCP. Docker recommends SSH or mutually authenticated
  TLS when remote access is needed. [Protect Docker daemon socket](https://docs.docker.com/engine/security/protect-access/)
- an activation-scoped, read-only credential-file mount supplied by the
  existing systemd credential launcher, not an environment variable or image
  layer. The Runner reads the key and Runner transport credential from that
  mount, but never copies them into the state volume.

A read-only socket bind does not limit Docker API operations; Unix-socket
permissions determine access.  The configuration must therefore not describe
the socket mount as a security boundary.

Docker bind mounts are writable by default and reference paths on the daemon
host, not on the API client. The adapter must reject every Job request that
asks for a host bind mount. [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)

### Credentials and state

ADR 0004 remains the credential decision.  Keep its encrypted mutable OAuth
record in the Runner-only named volume, and have the host systemd unit decrypt
the immutable store key with `LoadCredentialEncrypted=` before starting the
Runner container. Mount exactly that activation file read-only into the
Runner; do not pass it through an environment variable, command line, image,
or Job sandbox. This preserves the ADR's boundary: the control plane and Job
sandboxes never receive reusable credentials.

Do not use image build arguments or environment variables for secrets: Docker
documents that they persist in the final image or its metadata. [Docker build
secrets](https://docs.docker.com/build/building/secrets/)

The named volume contains durable Runner state only. A Job receives a fresh
anonymous workspace volume (if its writable layer is not used), labeled and
recorded with the Job identity. Docker retains anonymous volumes after a
container is removed unless removal includes volumes, so cleanup must handle
them explicitly. [Volume lifecycle](https://docs.docker.com/engine/storage/volumes/)

### Job sandbox policy and cleanup

The selected deployment implements, rather than changes, ADR 0003 and ADR
0005:

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

## Operator runbook

This is the intended reproducible first deployment, not a request to expose a
Docker daemon remotely.

1. On `homeserv1`, verify the local Engine is healthy, its Unix socket is not
   published on unauthenticated TCP, and the service account can connect only
   through the socket. Record the socket group numeric GID. Confirm the
   approved Runner and Job images by immutable digest.
2. Build and load the digest-pinned Debian+Bun Runner image. Create the one
   `ornn-runner-state` named volume, label it as Runner-owned, and initialise
   its ownership for the image's fixed non-root UID with a one-off trusted
   helper. Do not use a general host directory as the Runner state mount.
3. Install a dedicated systemd launcher service for the service account. It
   loads the encrypted store key and Runner transport credential with
   `LoadCredentialEncrypted=`, starts exactly one named Runner container, and
   restarts it on failure. The service supplies only: the state volume, the
   Docker socket, and individual read-only activation credential files.
4. Start the service and require readiness before it advertises capacity:
   local state is writable; the encrypted credential store validates; the
   control-plane transport authenticates; Engine `/_ping` and API-version
   negotiation succeed; required sandbox-image digests are present; and no
   owned resource is quarantined. Report only sanitized reason codes.
5. Use a container `HEALTHCHECK` for liveness/readiness state. Docker records
   a health command's `starting`, `healthy`, or `unhealthy` status and retry
   results, which operators can inspect. [Dockerfile HEALTHCHECK](https://docs.docker.com/reference/dockerfile/#healthcheck)
6. For an update, drain Runner capacity, finish or quarantine existing
   sandboxes, stop the systemd service, replace the Runner image digest, and
   start the service. The named state volume and host Docker resources survive
   replacement. On startup, reconcile the ledger with label discovery before
   accepting a lease. Roll back by restoring the prior image digest, never by
   deleting state or running a broad Docker prune.

## Proof-of-concept plan

Run these against a disposable local host first, then `homeserv1`. Do not use
production credentials; use a disposable control-plane registration and a
canary value to prove non-disclosure.

1. Build the Debian+Bun image and start it with the runbook's mounts and
   restrictions. Assert that it has no Docker daemon, host network/PID
   namespace, or host directories beyond the socket and one credential file.
2. Through the Runner's Docker adapter, create a fixture Job sandbox. Verify
   its deterministic name and labels, `network=none`, `restart=no`, resource
   settings, absence of socket/host/Runner mounts, and a credential-free
   workspace.
3. Execute a fixture command, collect an artifact, cancel another long-running
   fixture, and demonstrate whole-container termination. Remove each exact
   container and anonymous volume; prove both exact-ID inspection and
   ownership-label discovery report absence.
4. Kill the Runner container after each create, execute, collect, terminate,
   and destroy checkpoint. Restart it from the same state volume. It must
   adopt only an exact matching resource, quarantine a mismatch, and never
   release capacity merely because its previous process exited.
5. Test unavailable Docker and a denied socket. In both cases, cleanup remains
   pending or failed and capacity remains reserved; neither path may report
   verified deletion. Test that a Job cannot read the Runner state, activation
   credentials, Docker socket, or a different Job's workspace.
6. Exercise an image-digest update and rollback after a clean drain. Confirm
   that the Runner's credential record persists and that its plaintext never
   appears in the image, container inspection, environment, logs, labels,
   artifacts, or Job filesystem.

## ADR impact

No change to the decisions in ADR 0003 or ADR 0005 is required: the selected
deployment preserves their independent cleanup state, deterministic identity,
discovery, whole-container termination, and verified deletion rules.

ADR 0004's trust boundary also remains valid if systemd continues to deliver
the store key only to the Runner container as a read-only activation file. Add
an implementation note when the deployment is introduced to clarify that the
systemd service is now a container launcher and that the named volume replaces
the host `StateDirectory=` as the Runner's persistent state location. The note
must explicitly retain ADR 0004's no-sandbox-mount rule.

Moving to a rootless host Engine is a later, separately approved hardening
decision after a `homeserv1` proof establishes user-namespace operation,
cgroup-v2 resource enforcement, and recovery/cleanup parity. It is not an
ADR prerequisite for this first deployment.
