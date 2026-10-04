# Homeserv1 Incus Runner (development spike)

The Incus runner is separate from the existing Docker runner. Its control-plane ID is `runner_v1_3mF9rxJuCrswy7Ppb9EyPQ`, label `homeserv1-incus`; it is currently **paused**. Do not unpause it until a test Job can be routed to this runner without consuming unrelated pending work.

## Host layout

- Ubuntu 24.04 Incus 6.0, local socket only; system user `ornn-forge-incus` is in `incus`, not `incus-admin` or `docker`. Its restricted project is `user-996`.
- Project: at most two containers, two CPUs and 2 GiB aggregate memory; host-disk devices, nesting, GPUs and user-created networks are blocked. The default profile sets two CPUs, a 5 GiB root disk on `ornn-incus-zfs`, and a port-isolated NIC on `ornn-incusbr`.
- `ornn-incus-zfs` is a separate ZFS pool backed by the new 12 GiB file `/var/lib/incus/disks/ornn-incus-zfs.img` on the host's ext4 filesystem. It does not format either existing disk. Incus creates a filesystem dataset for each Job root disk and removes it with the instance. `volume.size=5GiB`, `volume.zfs.use_refquota=false`, and `volume.zfs.reserve_space=false` enforce a physical-space quota including snapshots, without reserving 5 GiB up front. ZFS compression means a quota is not a limit on logical file lengths. The pool and image cache also consume space, so two Jobs need not each have the full quota available simultaneously. The loop file provides a bounded local pool, not redundancy or a separate physical disk. See [Incus ZFS quotas](https://linuxcontainers.org/incus/docs/main/reference/storage_zfs/).
- Dataset delegation is disabled with `volume.zfs.delegate=false`. Incus 6.0 on this ZFS 2.2 host nevertheless automatically exposes `/dev/zfs` to unprivileged containers. `/etc/udev/rules.d/99-ornn-zfs.rules` keeps this host control device root-owned with mode `0600`. The Runner account uses the Incus API and does not need to open the device. Job root cannot open or chmod it, and device-node creation remains denied. Project low-level configuration restrictions remain enabled.
- The old `ornn-incus-pool` Btrfs pool remains intact for rollback, including its cached image. It no longer backs new Jobs. `/var/lib/ornn-incus-runner/profile-before-zfs.yaml` retains the original profile.
- `ornn-incusbr` is `10.39.79.1/24`, IPv6 off, NAT to the public interface. ACL `ornn-public-egress` blocks private, loopback, link-local, CGNAT, multicast and other non-public IPv4 destinations. UFW allows only the bridge's DHCP/DNS and outbound forwarding. DNS/DHCP to the bridge gateway remain reachable by design. Recheck these rules after a host reboot.
- The private image is pinned by fingerprint `2685fc80ffd3b46fc197680eebd348c03a69bdf62aa0fac983ffe49e4a91418f`, alias `ornn-bun-1.4.2-ubuntu24.04`: Ubuntu 24.04, Git, CA certificates and Bun 1.4.2. Its current Incus expiry is **2026-10-27**; rebuild or republish it before then.
- Unit: `/etc/systemd/system/ornn-forge-incus-runner.service`; non-secret settings: `/etc/ornn-forge/incus-runner.env`; encrypted transport credential: `/etc/credstore.encrypted/ornn-incus-runner.transport-credential`; state: `/var/lib/ornn-incus-runner`. Runner source is in `/home/ornn-forge-incus/ornn-forge`.

## Inspect and test

```sh
ssh root.homeserv1 'systemctl status ornn-forge-incus-runner.service'
ssh root.homeserv1 'incus project show user-996; incus profile show default --project user-996'
ssh root.homeserv1 'runuser -u ornn-forge-incus -- incus list --project user-996'
ssh root.homeserv1 'incus storage info ornn-incus-zfs; zfs list -r -o name,used,quota,refquota ornn-incus-zfs; incus network show ornn-incusbr'
```

The ready marker `/var/lib/ornn-incus-runner/control-connection.ready` proves authenticated control synchronization, not Job completion. To repeat the public-repository container test:

```sh
ssh root.homeserv1 'cd /home/ornn-forge-incus/ornn-forge && runuser -u ornn-forge-incus -- env ORNN_INCUS_PROJECT=user-996 ORNN_INCUS_TEST_IMAGE=2685fc80ffd3b46fc197680eebd348c03a69bdf62aa0fac983ffe49e4a91418f ORNN_INCUS_TEST_REVISION=37b19f9fd6f9439b1535889e5a6f8a4312b321b2 /opt/ornn-forge/bun/bin/bun test apps/runner/src/sandbox.incus.integration.test.ts'
```

The test starts a container, clones that exact SHA **inside** it through the production workspace importer, runs `bun install --frozen-lockfile`, checks that the temporary credential file is gone and the Git remote contains no token, transfers and collects a file, then stops and deletes the container. It uses a dummy token against a public repository: it does not prove private-token checkout, control-plane Job routing, runner recovery after host reboot or production-grade network isolation.

## Set up ZFS and test Runner restart

Both scripts run as root on `homeserv1` and require the Runner to be active but idle, with an empty Job project and no active leases or unresolved sandbox records. They stop the service and repeat those checks before proceeding. They restart the service on exit and leave its control-plane pause setting unchanged.

```sh
scp scripts/setup-incus-zfs root.homeserv1:/tmp/ornn-setup-incus-zfs
ssh root.homeserv1 'bash /tmp/ornn-setup-incus-zfs'
scp scripts/smoke-incus-zfs root.homeserv1:/tmp/ornn-smoke-incus-zfs
ssh root.homeserv1 'bash /tmp/ornn-smoke-incus-zfs'
```

Setup creates the pool if absent, sets storage defaults, installs the udev rule, and changes the root disk in the restricted project's default profile. Repeating setup reuses the pool. It does not move existing instances, delete the Btrfs pool, modify credentials, or relax project restrictions.

The smoke protects Ornn's Job storage limit, ownership-based startup cleanup, and network policy. It checks the actual 5 GiB dataset quota, attempts a 6 GiB incompressible write, and requires a quota/full-disk error. It tests host control-device access and device-node creation as Job root. With the service stopped, it creates an orphan with the deployed Runner's ownership metadata and a second container owned by a distinct probe Runner. Starting the deployed service must remove only its orphan, including the exact ZFS dataset and Incus volume, before writing a fresh synchronization marker. The peer must survive.

On Incus 6.0, a completely full dataset can initially prevent the ownership reset during stop/delete. ZFS metadata accounting can also temporarily report usage slightly above the quota when the final write is rejected. The smoke requires the actual write to fail and removes its known fill file before subsequent tests. A full real Job can therefore delay teardown; a failed or uncertain stop/delete must continue to retain capacity and must never be reported as verified cleanup. The first full-disk probe on 2026-10-04 hit this stop error; the restarted Runner subsequently removed its owned instance and dataset.

Before and after that service restart, disposable containers must reach GitHub and the Bun npm registry and obtain DHCP/DNS through the bridge. TCP probes must fail for the host's bridge, LAN, Tailscale and Docker addresses, the LAN gateway, metadata/link-local, RFC1918 aliases, and the peer container. Controlled host and peer HTTP listeners are first verified reachable from the host, so their denial from a Job is meaningful. A hostname resolving to the metadata address must also remain blocked. IPv6 is disabled on the bridge and the Job must have no IPv6 default route. Temporary listeners, address aliases, containers, and Job datasets are removed even after a failed test.

This is a **Runner service restart** test. It does not prove host-reboot persistence, a live control-plane Job failure/recovery, Force Quit, or uncertain cleanup recovery from #27. A host reboot followed by the same probes remains required by #24.

### Verified on 2026-10-04

The complete smoke for `ornn-zfs-probe-20261004123536` and `ornn-peer-probe-20261004123536` passed with 44 checks. The fill write stopped at 5,367,529,472 bytes with `Disk quota exceeded`. The deployed Runner discovered and deleted its orphan, including its dataset and Incus volume, then synchronized as a new process. The peer still served its controlled HTTP response from the host after that restart. All public/DHCP/DNS and denied TCP/hostname probes passed both before and after the service restart. Cleanup left no Job instance, Job dataset, probe listener, or temporary address.

The existing `sandbox.incus.integration.test.ts` also passed on the ZFS profile: one test, six assertions, approximately 28 seconds. It used pinned repository revision `37b19f9fd6f9439b1535889e5a6f8a4312b321b2`, cloned through the production importer, installed frozen Bun dependencies, transferred its artifact, and removed its instance. The pool was healthy afterward, the project was empty, and the Runner service remained active. `bash -n`, ShellCheck, and `git diff --check` passed for the repository changes.

## Roll back the root storage profile

With the Runner stopped and its Job project and lease ledger empty, restore the saved profile:

```sh
ssh root.homeserv1 'incus profile edit default --project user-996 < /var/lib/ornn-incus-runner/profile-before-zfs.yaml'
```

Start the Runner again and require a fresh synchronization marker. Leave both pools in place until their instance, volume, and image references have been inspected. Keep the root-only ZFS device rule while any ZFS pool remains on the host.
