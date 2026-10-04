# Homeserv1 Incus Runner

The Incus runner is separate from the paused Docker runner. Its control-plane ID is `runner_v1_3mF9rxJuCrswy7Ppb9EyPQ`, label `homeserv1-incus`, and it currently accepts Job leases. Keep the Docker runner paused while testing Incus. The private-repository test target is `bjesuiter/bgf-wlan-translation-v5`; check the GitHub App installation and repository allowlist before creating another test Invocation.

## Host layout

- Ubuntu 24.04 Incus 6.0, local socket only; system user `ornn-forge-incus` is in `incus`, not `incus-admin` or `docker`. Its restricted project is `user-996`.
- Project: at most two containers, two CPUs and 2 GiB aggregate memory; host-disk devices, nesting, GPUs and user-created networks are blocked. The default profile sets two CPUs, a 5 GiB root disk on `ornn-incus-pool`, and a port-isolated NIC on `ornn-incusbr`.
- `ornn-incus-pool` is a separate 12 GiB loop-backed Btrfs pool. It bounds the spike's total storage, but Btrfs qgroup limitations mean the 5 GiB per-container quota is not a strict security boundary. A dedicated ZFS pool/disk should replace it before treating arbitrary repositories as hostile production workloads.
- `ornn-incusbr` is `10.39.79.1/24`, IPv6 off, NAT to the public interface. ACL `ornn-public-egress` blocks private, loopback, link-local, CGNAT, multicast and other non-public IPv4 destinations. UFW allows only the bridge's DHCP/DNS and outbound forwarding. DNS/DHCP to the bridge gateway remain reachable by design. Recheck these rules after a host reboot.
- The private image is pinned by fingerprint `2685fc80ffd3b46fc197680eebd348c03a69bdf62aa0fac983ffe49e4a91418f`, alias `ornn-bun-1.4.2-ubuntu24.04`: Ubuntu 24.04, Git, CA certificates and Bun 1.4.2. Its current Incus expiry is **2026-10-27**; rebuild or republish it before then.
- Unit: `/etc/systemd/system/ornn-forge-incus-runner.service`; non-secret settings: `/etc/ornn-forge/incus-runner.env`; encrypted transport credential: `/etc/credstore.encrypted/ornn-incus-runner.transport-credential`; state: `/var/lib/ornn-incus-runner`. Runner source is in `/home/ornn-forge-incus/ornn-forge`.

## Inspect and test

```sh
ssh root.homeserv1 'systemctl status ornn-forge-incus-runner.service'
ssh root.homeserv1 'incus project show user-996; incus profile show default --project user-996'
ssh root.homeserv1 'runuser -u ornn-forge-incus -- incus list --project user-996'
ssh root.homeserv1 'incus storage info ornn-incus-pool; incus network show ornn-incusbr'
```

The ready marker `/var/lib/ornn-incus-runner/control-connection.ready` proves authenticated control synchronization, not Job completion. To repeat the public-repository container test:

```sh
ssh root.homeserv1 'cd /home/ornn-forge-incus/ornn-forge && runuser -u ornn-forge-incus -- env ORNN_INCUS_PROJECT=user-996 ORNN_INCUS_TEST_IMAGE=2685fc80ffd3b46fc197680eebd348c03a69bdf62aa0fac983ffe49e4a91418f ORNN_INCUS_TEST_REVISION=37b19f9fd6f9439b1535889e5a6f8a4312b321b2 /opt/ornn-forge/bun/bin/bun test apps/runner/src/sandbox.incus.integration.test.ts'
```

The test starts a container, clones that exact SHA **inside** it through the production workspace importer, runs `bun install --frozen-lockfile`, checks that the temporary credential file is gone and the Git remote contains no token, transfers and collects a file, then stops and deletes the container. It uses a dummy token against a public repository. Live Jobs for issue #69 and [the private-repository fixture](https://github.com/bjesuiter/bgf-wlan-translation-v5/issues/281) proved control-plane routing, private-token checkout, dependency installation, and verified Incus cleanup. Runner recovery after host reboot and production-grade network isolation remain unproved.
