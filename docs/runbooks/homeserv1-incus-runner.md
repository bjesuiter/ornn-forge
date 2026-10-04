# Homeserv1 Incus Runner

The Incus runner is separate from the paused Docker runner. Its control-plane ID is `runner_v1_3mF9rxJuCrswy7Ppb9EyPQ`, label `homeserv1-incus`, and it currently accepts Job leases. Keep the Docker runner paused while testing Incus. The private-repository test target is `bjesuiter/bgf-wlan-translation-v5`; check the GitHub App installation and repository allowlist before creating another test Invocation.

## Host layout

- Ubuntu 24.04 Incus 6.0, local socket only; system user `ornn-forge-incus` is in `incus`, not `incus-admin` or `docker`. Its restricted project is `user-996`.
- The Incus user proxy's certificate `incus-user-996` must have `restricted=true` and the persisted project grant `projects=[user-996]`. An empty project list denies the Runner's access even if its systemd process remains active. Setup writes this exact grant through the trust API; the smoke checks both the grant and denial of the default project. See [Incus authorization](https://linuxcontainers.org/incus/docs/main/authorization/).
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

The test starts a container, clones that exact SHA **inside** it through the production workspace importer, runs `bun install --frozen-lockfile`, checks that the temporary credential file is gone and the Git remote contains no token, transfers and collects a file, then stops and deletes the container. It uses a dummy token against a public repository. Live Jobs for issue #69 and [the private-repository fixture](https://github.com/bjesuiter/bgf-wlan-translation-v5/issues/281) separately proved control-plane routing, private-token checkout, dependency installation, and verified Incus cleanup. The following sections record host-reboot, isolation, and Force Quit evidence.

## Set up ZFS and test Runner restart

Both scripts run as root on `homeserv1` and require the Runner to be active but idle, with an empty Job project and no active leases or unresolved sandbox records. They stop the service and repeat those checks before proceeding. They restart the service on exit and leave its control-plane pause setting unchanged.

```sh
scp scripts/setup-incus-zfs root.homeserv1:/tmp/ornn-setup-incus-zfs
ssh root.homeserv1 'bash /tmp/ornn-setup-incus-zfs'
scp scripts/smoke-incus-zfs root.homeserv1:/tmp/ornn-smoke-incus-zfs
ssh root.homeserv1 'bash /tmp/ornn-smoke-incus-zfs'
```

Setup persists the user proxy certificate's restricted project grant, creates the pool if absent, sets storage defaults, installs the udev rule, and changes the root disk in the restricted project's default profile. Repeating setup reuses the pool and certificate. It does not move existing instances, delete the Btrfs pool, rotate credentials, or relax project restrictions.

The smoke protects Ornn's Job storage limit, ownership-based startup cleanup, and network policy. It checks the actual 5 GiB dataset quota, attempts a 6 GiB incompressible write, and requires a quota/full-disk error. It tests host control-device access and device-node creation as Job root. With the service stopped, it creates an orphan with the deployed Runner's ownership metadata and a second container owned by a distinct probe Runner. Starting the deployed service must remove only its orphan, including the exact ZFS dataset and Incus volume, before writing a fresh synchronization marker. The peer must survive.

On Incus 6.0, a completely full dataset can initially prevent the ownership reset during stop/delete. ZFS metadata accounting can also temporarily report usage slightly above the quota when the final write is rejected. The smoke requires the actual write to fail and removes its known fill file before subsequent tests. A full real Job can therefore delay teardown; a failed or uncertain stop/delete must continue to retain capacity and must never be reported as verified cleanup. The first full-disk probe on 2026-10-04 hit this stop error; the restarted Runner subsequently removed its owned instance and dataset.

Before and after that service restart, disposable containers must reach GitHub and the Bun npm registry and obtain DHCP/DNS through the bridge. TCP probes must fail for the host's bridge, LAN, Tailscale and Docker addresses, the LAN gateway, metadata/link-local, RFC1918 aliases, and the peer container. Controlled host and peer HTTP listeners are first verified reachable from the host, so their denial from a Job is meaningful. A hostname resolving to the metadata address must also remain blocked. IPv6 is disabled on the bridge and the Job must have no IPv6 default route. Temporary listeners, address aliases, containers, and Job datasets are removed even after a failed test.

The script performs a **Runner service restart**. To prove host-reboot persistence, first reboot homeserv1, record a changed `/proc/sys/kernel/random/boot_id`, and verify automatic service startup, a fresh Runner synchronization marker, an online ZFS pool, and root-only `/dev/zfs` access. Inspect the persisted trust grant and test the account's project access. Then run the smoke and checkout integration test without reapplying setup or repairing the host first. This still does not prove a live control-plane Job failure/recovery, Force Quit, or uncertain cleanup recovery from #27.

### Verified on 2026-10-04

The complete smoke for `ornn-zfs-probe-20261004123536` and `ornn-peer-probe-20261004123536` passed with 44 checks. The fill write stopped at 5,367,529,472 bytes with `Disk quota exceeded`. The deployed Runner discovered and deleted its orphan, including its dataset and Incus volume, then synchronized as a new process. The peer still served its controlled HTTP response from the host after that restart. All public/DHCP/DNS and denied TCP/hostname probes passed both before and after the service restart. Cleanup left no Job instance, Job dataset, probe listener, or temporary address.

The existing `sandbox.incus.integration.test.ts` also passed on the ZFS profile: one test, six assertions, approximately 28 seconds. It used pinned repository revision `37b19f9fd6f9439b1535889e5a6f8a4312b321b2`, cloned through the production importer, installed frozen Bun dependencies, transferred its artifact, and removed its instance. The pool was healthy afterward, the project was empty, and the Runner service remained active. `bash -n`, ShellCheck, and `git diff --check` passed for the repository changes.

### Host reboot and project-access fix on 2026-10-04

The first reboot at 13:11:13 UTC changed boot ID `1f9d4d33-6b15-4316-99cf-09271ad669f1` to `53f584b8-071b-4fc2-a64f-31c93c7ffc26` and loaded kernel `6.8.0-142-generic`. ZFS, Incus, UFW, Docker, Tailscale, SSH and the Runner process started automatically, but Runner synchronization failed. The existing proxy certificate was still the same, while its trust entry had `restricted=true` and an empty project list. The actual account command `runuser -u ornn-forge-incus -- incus list --project user-996` reproducibly failed with `User does not have permissions for project`.

Persisting only `projects=[user-996]` restored account access and synchronization. The project remained restricted, the account remained outside `incus-admin`, and access to the default project was denied. The certificate/project association was also confirmed in Incus's persisted database. Setup now writes this grant explicitly; the smoke rejects a missing or broader grant before changing any service or instance.

A second reboot at 13:19:05 UTC changed boot ID to `0c12ae2d-24f8-4138-9bac-601b9ecdf851`. Without any post-boot repair, the Runner started at 13:19:57 UTC with zero service restarts and synchronized at 13:19:58 UTC. Its persisted restricted-project grant survived, the ZFS pool was online, `/dev/zfs` remained root-owned with mode `0600`, and UFW/Docker/Tailscale/SSH came up automatically. Incus activated its loop-backed ZFS pool; `zfs-import-cache.service` itself was skipped because the cache file was empty after clean shutdown. That skipped unit did not prevent automatic pool activation. The four NAS mounts that had already failed before the test also failed after boot; Runner paths are on the local root filesystem.

The post-reboot smoke for `ornn-zfs-probe-20261004132046` and `ornn-peer-probe-20261004132046` passed all 45 checks, including the persisted trust restriction and default-project denial. The quota write failed at 5,365,694,464 bytes with `Disk quota exceeded`. Public GitHub/Bun package access, DHCP/DNS, and all denied host/LAN/Tailscale/Docker/metadata/peer TCP and hostname probes passed before and after the script's additional Runner restart. Ownership-based orphan removal, preservation of the foreign peer, and exact Job-instance/volume/dataset absence also passed. No storage, firewall, permission or service repair was applied after the successful host boot.

The pinned checkout/Bun/artifact integration test then passed with six assertions in approximately 26 seconds. Both tests left the restricted project empty. The host-reboot network-isolation criterion in #24 now has live evidence; Force Quit and broader uncertain-cleanup/control-plane recovery remain separate acceptance work.

## Force Quit and cleanup faults

The Incus driver records the expanded root disk's exact pool/container/instance identity in the sandbox lease. It checks both instance absence and that exact root volume's absence before reporting verified cleanup. A missing identity or unavailable storage query keeps cleanup unresolved. The restricted account can list its project volumes on a known pool without permission to list or administer host pools. See [Incus storage-volume inspection](https://linuxcontainers.org/incus/docs/main/howto/storage_volumes/).

After a failed Force Quit, the control plane preserves the cancelled execution outcome and its timestamp, exposes failed cleanup to Operator inspection, and retains the capacity reservation. The same Force Quit command remains pending until cleanup is verified. The existing 30-second Runner heartbeat redelivers it; a retry verifies current instance and storage absence without starting Job execution again. Duplicate reports do not create another execution outcome or duplicate terminal events. This is the narrow Force Quit retry path; the general recovery/reaper policy from ADR 0003 and #27 remains separate work.

Run the live test only while the project is empty and the deployed Runner has no active leases. Use a checkout containing `force-quit.incus.integration.test.ts`; the verified run used a separate source copy at `/home/ornn-forge-incus/ornn-forcequit-probe-20261004`, leaving the service's checkout and control-plane pause setting unchanged.

```sh
ssh root.homeserv1 'cd /home/ornn-forge-incus/ornn-forcequit-probe-20261004 && runuser -u ornn-forge-incus -- env ORNN_INCUS_PROJECT=user-996 ORNN_INCUS_TEST_IMAGE=2685fc80ffd3b46fc197680eebd348c03a69bdf62aa0fac983ffe49e4a91418f /opt/ornn-forge/bun/bin/bun test apps/runner/src/force-quit.incus.integration.test.ts'
bun run test:worker
```

The live test exercises `runRemoteRunner`'s production Force Quit handler and the real Incus CLI under the restricted service account. A disposable control socket supplies leases and repeated commands; no production Operator or Runner credential is used. Each Job starts a detached child that ignores TERM and writes a marker, then blocks in another sandbox command. Force Quit must remove the whole Job, suppress its normal result, retain local lease/storage records on failure, and remove them only after verified cleanup. A different Job under the same probe Runner identity remains running and executable. Four gateway faults model a rejected stop, rejected delete, a lost reply after a successful real delete, and unavailable storage inspection. Each fault occurs once, then the same command retries. Both containers explicitly use one CPU because the project allows only two CPUs in total. Probe control errors stop the test instead of reconnecting and repeating Job creation.

On 2026-10-04, all five live tests passed in approximately 66 seconds with 62 assertions. The ordinary case reported `verified`; all four faults reported `failed` followed by `verified`. The Job instance names were `ornn-8bb79f5245e2d65a031a7c79d2a3eb7c62c7319d`, `ornn-20368894e0b1b05f8161951cb5719a184595af7b`, `ornn-6b592f3cdb0cd224b4857fe2bedc4c820c16ad17`, `ornn-0175070ebebcd5e44b1983b5a8f84a05d647531f`, and `ornn-3ad0c44d7d06b12ed57a8a34c16fa3e3291ac14c`. A subsequent root inspection found no project instance, Incus volume, live Job dataset, or deleted Job dataset. The ZFS pool remained healthy and the deployed Runner active with zero local leases/sandbox records.

An additional ordinary Force Quit probe passed with 11 assertions after explicitly checking that the exact root volume was present before cancellation and absent afterward. Discovery also refuses an owned instance with an unknown root pool instead of silently hiding it.

The first test setup accidentally requested the profile's two CPUs for each of two containers. Its reconnect loop repeatedly retried the rejected creation and overloaded Incus with requests, producing transaction timeouts. The test process was stopped and its exact owned peer removed; Incus recovered without a daemon restart. Explicit one-CPU probe limits and immediate termination on control errors fixed the test setup before the successful run.

Separately, all seven real D1/Worker WebSocket tests passed. The Force Quit test reports failed cleanup, proves the reservation remains occupied, observes command redelivery on a heartbeat, then reports verified cleanup and proves the reservation is released. It also checks preserved cancellation timestamps, duplicate/stale report handling, and one ordered request/completion/cleanup event sequence. The authenticated Operator API test shows cancelled execution and failed cleanup, fences late results, blocks a second pending Job, and permits it only after verified cleanup. Existing dashboard SQL tests retain failed-cleanup Jobs in Operator views. All 90 local tests passed, with six live Incus tests skipped locally, and TypeScript checks passed.

These are complementary live Incus and real D1 protocol tests. They do not claim an end-to-end production Operator/API cancellation or the full restart/publication recovery smoke required by #27. The initial evidence above preceded deployment; the rollout below verifies the deployed code.

### Production rollout on 2026-10-04

Implementation commit `1adfc8f3779d45eaee0c1de3b281a2def03bcc03` was pushed and deployed through `bun run deploy`. No D1 migrations were pending. The production Worker version is `b71829e6-bd89-4b7a-9f87-2f9d50554377` at `https://ornn-forge.bjesuiter.workers.dev`.

The idle Incus service checkout received the committed gateway, driver, and tests. The unchanged coordinator's SHA-256 matched the committed source. The service was stopped for replacement, its old driver/gateway were saved at `/var/lib/ornn-incus-runner/source-before-1adfc8f.tar`, and it restarted as PID 65959 with zero service restarts. A freshly recreated synchronization marker records `2026-10-04T16:18:17.717Z`. Deployed gateway/driver SHA-256 hashes matched the local committed files. Runner credentials and its control-plane pause setting were preserved.

Read-only production D1 inspection confirmed the Incus Runner was `ready`, its presence advanced to `2026-10-04T16:18:47.843Z`, and it held zero capacity reservations. All five Force Quit/fault tests then passed from `/home/ornn-forge-incus/ornn-forge`, the deployed service checkout, with 67 assertions in approximately 70 seconds. The pinned checkout/Bun/artifact test also passed with six assertions in approximately 26 seconds. The Force Quit tests still use a disposable control socket; the service's fresh synchronization and production D1 presence independently verify its deployed production connection.

## Roll back the root storage profile

With the Runner stopped and its Job project and lease ledger empty, restore the saved profile:

```sh
ssh root.homeserv1 'incus profile edit default --project user-996 < /var/lib/ornn-incus-runner/profile-before-zfs.yaml'
```

Start the Runner again and require a fresh synchronization marker. Leave both pools in place until their instance, volume, and image references have been inspected. Keep the root-only ZFS device rule while any ZFS pool remains on the host.
