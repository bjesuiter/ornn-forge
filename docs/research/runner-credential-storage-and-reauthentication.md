# Runner credential storage and reauthentication

Status: research complete

Last verified: 2026-09-05

Issue: [#18](https://github.com/bjesuiter/ornn-forge/issues/18)

## Decision

For the first Remote Runner on `homeserv1`, use a **systemd-credential-bootstrapped, envelope-encrypted local credential store**:

1. Generate one random 32-byte Runner store key during host setup. Encrypt that key with `systemd-creds encrypt --with-key=host` and install only the ciphertext in `/etc/credstore.encrypted/`.
2. Run the Remote Runner as a dedicated user in a system service. Deliver the store key at activation with `LoadCredentialEncrypted=`. systemd decrypts it into the service's read-only `$CREDENTIALS_DIRECTORY`, which is restricted to the service UID and root and uses unswappable memory when the host supports it ([systemd.exec 255](https://www.freedesktop.org/software/systemd/man/255/systemd.exec.html#Credentials)). Do not put it in an environment variable, command line, config file, or job-scoped data.
3. Implement Pi's application-owned `CredentialStore` interface with an Ornn store that encrypts the complete mutable OpenAI OAuth record using AES-256-GCM and the store key. Persist the ciphertext as `/var/lib/ornn-runner/openai-codex.credential` with a `0700` parent directory and `0600` file. Pi explicitly permits an application-supplied credential store, and its `modify` operation is designed to serialize refresh-token replacement ([Pi credential-store contract at the verified revision](https://github.com/earendil-works/pi/blob/da840b6216578c2a571d0374ac6a2091a83f9d91/packages/ai/src/auth/types.ts), [ModelRuntime injection point](https://github.com/earendil-works/pi/blob/da840b6216578c2a571d0374ac6a2091a83f9d91/packages/coding-agent/src/core/model-runtime.ts)). Do not use Pi's default plaintext `auth.json` backend.
4. Keep device authorization and token refresh entirely in the Runner. The control plane displays the verification URI and one-time user code in a private authenticated operator view and carries sanitized status; it never receives the device authorization ID, authorization code, PKCE verifier, access token, refresh token, locally extracted account ID, store key, or decrypted store.

This is the smallest mechanism that supports unattended service and host restart while keeping the reusable credential out of Cloudflare, sandboxes, logs, artifacts, and other Runners. It also fits Pi's refresh behavior without a privileged helper: systemd protects the stable store key, while the unprivileged Runner can atomically rewrite the rotating OAuth ciphertext.

### Accepted v1 limitation

This choice does **not** protect against root compromise or offline theft of the complete `homeserv1` system disk. In host-key mode, systemd protects credentials with `/var/lib/systemd/credential.secret`; an attacker who obtains that root-only key and the encrypted store can decrypt the store key ([systemd-creds 255](https://www.freedesktop.org/software/systemd/man/255/systemd-creds.html#encrypt%20input%7C-%20output%7C-)). `homeserv1` currently boots from a plain ext4 partition rather than a LUKS mapping, so the key and ciphertext reside on the same unencrypted disk.

The v1 boundary therefore protects against repository content, job containers, accidental file disclosure, backups that exclude the systemd host key, and unprivileged host users. It does not claim protection from a hostile host administrator, a compromised Runner process, or physical disk acquisition. That is consistent with the selected trusted-Runner topology, but it must remain visible in deployment documentation.

Add full-disk LUKS protection or usable TPM2-backed systemd credentials before treating offline disk theft as covered. Neither is available today, and neither should block the first Runner.

## Facts observed on `homeserv1`

The following were read-only observations over the existing SSH access. No credential files or secret values were read.

| Fact | Observed result | Consequence |
| --- | --- | --- |
| OS | Ubuntu 24.04, Linux 6.8 | system services and modern systemd credentials are available |
| systemd | 255; `systemd-creds` installed | `LoadCredentialEncrypted=` and host-key encryption are available |
| Credential stores | `/etc/credstore` and `/etc/credstore.encrypted` exist, mode `0700`, owned by root | Matches systemd's standard search path |
| TPM | `/sys/class/tpm/tpm0/tpm_version_major` reports `1` | This is TPM 1.x, not TPM2 |
| TPM2 probe | `systemd-creds has-tpm2` reports `partial`, exits 19; a `--with-key=tpm2` encryption probe fails with `Operation not supported` | TPM2 sealing is not a v1 option |
| Root storage | `/dev/sda2`, ext4 directly mounted at `/` | No observed full-disk encryption for the root filesystem |
| Other tools | `secret-tool`, `pass`, `age`, and `sops` absent; `keyctl` present | No already-operated persistent keyring or file-encryption workflow exists; the kernel keyring alone is volatile |
| Runner service | No installed unit whose name contains `ornn` or `runner` | Storage can be incorporated into initial Runner service installation rather than migrated |

The TPM probe used only a fixed non-secret test string and discarded its output. It did not create a host key or modify service configuration.

## Options considered

| Option | Restart behavior | Security and operational fit | Verdict |
| --- | --- | --- | --- |
| Pi's default `auth.json`, mode `0600` | Unattended | Reusable access and refresh tokens remain plaintext. OpenAI says file-based auth caches contain access tokens and must be treated like passwords ([OpenAI authentication](https://developers.openai.com/codex/auth.md#credential-storage)). | Reject |
| Desktop Secret Service/libsecret | Usually requires a login session and unlocked collection | No configured CLI/store was found; headless boot and recovery would add a desktop/session dependency. | Reject |
| `pass`, age, or SOPS | Unattended only if their private key is also locally available | None is installed. Storing its decryption key beside the ciphertext recreates the same root/offline limitation with more custom setup; requiring a passphrase prevents unattended restart. | Reject for v1 |
| Kernel keyring only | Does not survive reboot | Useful for runtime caching, not persistent recovery. | Reject |
| LUKS root encryption | Depends on an operator, TPM2, or a separate network-bound unlock design | Stronger against offline theft, but not present and materially expands host boot/recovery work. | Later hardening gate |
| TPM2-backed `systemd-creds` | Unattended; can bind decryption to hardware and OS installation | Preferred when supported, but `homeserv1` has TPM 1.x and the TPM2 probe fails. | Unavailable now; later hardening gate |
| Host-key `systemd-creds` protecting a mutable encrypted store | Unattended | Available now, native to the service manager, no desktop agent, and plaintext is confined to the trusted Runner. Explicitly weak against root/offline disk acquisition. | **Select for v1** |

systemd credentials are intended to replace secret-bearing environment variables and ordinary files. Encrypted credentials use authenticated AES-256-GCM with a TPM2-derived key, `/var/lib/systemd/credential.secret`, or both; decryption occurs at service activation ([systemd credentials overview](https://systemd.io/CREDENTIALS/), [systemd-creds 255](https://www.freedesktop.org/software/systemd/man/255/systemd-creds.html)).

## Local store contract

### Files and service boundary

- `/etc/credstore.encrypted/ornn-runner.store-key`: systemd-encrypted 32-byte store key, root-owned and mode `0600` inside a root-owned `0700` directory.
- `/var/lib/systemd/credential.secret`: root-only systemd host key, created by `systemd-creds` when host-key encryption is first used. It is never read by Ornn.
- `/var/lib/ornn-runner/openai-codex.credential`: the Runner-managed AES-256-GCM ciphertext.
- `$CREDENTIALS_DIRECTORY/ornn-runner.store-key`: activation-scoped plaintext store key supplied by systemd. The Runner reads it directly and never copies it into its state directory.

The unit should use a dedicated `User=`, `StateDirectory=ornn-runner`, `UMask=0077`, `LoadCredentialEncrypted=ornn-runner.store-key`, `NoNewPrivileges=yes`, and `LimitCORE=0`. Exact Docker-related unit hardening belongs to the Runner deployment because the sandbox driver may need a separately mediated Docker capability.

Neither the systemd credential directory, Runner state directory, Runner process environment, `/etc/credstore*`, nor `/var/lib/systemd/credential.secret` may be mounted or copied into a job container. The Runner passes Pi only a `CredentialStore` object; it does not expose an auth path to Pi tools or the sandbox.

### Ciphertext and writes

Use a versioned binary envelope containing only a format/version marker, algorithm identifier, random 96-bit nonce, authentication tag, and ciphertext. Bind at least `format version + Runner ID + provider ID` as AEAD additional authenticated data so a blob cannot be silently repurposed. Node's supported `crypto` API supplies authenticated encryption, secure random bytes, and authentication-tag handling ([Node.js crypto](https://nodejs.org/api/crypto.html)).

Every `CredentialStore.modify("openai-codex", ...)` must:

1. take the per-provider lock;
2. decrypt and authenticate the current record;
3. run Pi's mutation, including refresh when needed;
4. encrypt the complete replacement record with a fresh nonce;
5. write a new mode-`0600` file, `fsync` it, rename it over the prior file, and `fsync` the state directory;
6. return the replacement only after the durable write succeeds.

Never update in place. A crash must leave either the complete old record or the complete new record. If OpenAI rotates a refresh token but the new record cannot be persisted, mark the store failed and advertise zero authenticated capacity; do not continue using an in-memory token that will disappear at restart.

Pi's current OpenAI flow returns and stores `access`, `refresh`, `expires`, and an account ID. Refresh sends the locally held refresh token directly to OpenAI and expects a complete new access/refresh pair. Its device flow keeps `deviceAuthId`, authorization code, and PKCE verifier in the local process ([Pi OpenAI Codex OAuth at the verified revision](https://github.com/earendil-works/pi/blob/da840b6216578c2a571d0374ac6a2091a83f9d91/packages/ai/src/auth/oauth/openai-codex.ts)). The Ornn store must preserve the full replacement record locally but expose none of those fields through Runner events.

## Minimal reauthentication protocol

The control plane hosts an authenticated private operator view. Reauthentication instructions must never be published as a GitHub comment or public Ornn message. The browser goes directly to OpenAI; it never submits an OpenAI authorization response to Ornn.

All commands use the existing authenticated Runner transport, are bound to one registered Runner ID, and carry an opaque random `attemptId`. Only an authenticated operator action may create, cancel, or revoke. At most one nonterminal OpenAI reauthentication attempt exists per Runner.

| Direction | Message | Allowed payload |
| --- | --- | --- |
| Control plane to Runner | `reauth.start` | `attemptId`, fixed provider ID, `expiresAt`/deadline |
| Runner to control plane | `reauth.instructions` | `attemptId`, allowlisted HTTPS OpenAI verification URI, one-time `userCode`, `expiresAt` |
| Control plane to Runner | `reauth.cancel` | `attemptId` |
| Runner to control plane | `reauth.status` | `attemptId`, state, timestamp, sanitized reason code |
| Control plane to Runner | `credential.revoke_local` | provider ID and idempotency key; separate from attempt cancellation |
| Runner to control plane | Runner auth health | `ready`, `refreshing`, `reauth_required`, or `store_error`; optional token expiry timestamp, never token/account data |

The control plane does **not** need Pi/OpenAI's polling interval because the Runner polls OpenAI itself. It must reject an instructions event whose URI is not HTTPS and on the deployment's exact OpenAI authentication-origin allowlist; it must not turn an arbitrary Runner-provided URL into an operator-facing link. It must never receive `deviceAuthId`, authorization code, code verifier, access token, refresh token, account ID, raw JWT claims, raw provider responses, or the encrypted store. The one-time user code is authorization-sensitive despite being short-lived: show it only in the authenticated view, exclude it from telemetry and request logs, and clear it from control-plane state when the attempt becomes terminal or expires. Retain only attempt ID, Runner ID, timestamps, terminal state, and sanitized reason afterward.

Use this state machine:

```text
requested -> pending -> succeeded
                    \-> expired
                    \-> failed
                    \-> cancelled
                    \-> interrupted
```

- `pending` begins only after the Runner has received the OpenAI instructions and started polling.
- `succeeded` is emitted only after the exchanged OAuth record is durably encrypted locally and Runner auth health is `ready`.
- `cancelled`, `expired`, `failed`, and `interrupted` never modify an existing valid credential.
- Repeated starts with the same `attemptId` return the current snapshot. A start with a different ID while one is pending returns `already_in_progress` plus the existing attempt ID, not another code.
- Status events carry a monotonic attempt revision or event sequence so the control plane can reject stale/out-of-order delivery. On reconnect the Runner sends the current snapshot, making control-plane restart harmless.

OpenAI documents device-code login for remote/headless clients: the person visits the displayed link and enters a one-time code ([OpenAI headless login](https://developers.openai.com/codex/auth.md#login-on-headless-devices)). Pi currently fixes the device attempt timeout at 15 minutes and implements RFC-style polling and cancellation locally ([Pi device-code helper](https://github.com/earendil-works/pi/blob/da840b6216578c2a571d0374ac6a2091a83f9d91/packages/ai/src/auth/oauth/device-code.ts), [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)). The Runner should report the expiry received from its selected Pi version rather than making the control plane depend on 15 minutes as a permanent provider contract.

## Renewal and admission

On startup and before advertising authenticated Runner capacity, ask Pi's model/auth layer to resolve the OpenAI credential. This uses the locally injected store and allows a needed refresh to occur before a Job is leased. During operation, Pi's `CredentialStore.modify` contract serializes refresh per provider so concurrent sessions cannot refresh the same rotating token twice. The Ornn implementation must preserve that serialization and add a cross-process lock if deployment ever runs more than one Runner process against the same store.

- Refresh is Runner-to-OpenAI only. It produces no control-plane credential message.
- Persist the complete refreshed record before allowing the model request to proceed.
- For a transient network or OpenAI 5xx failure, retain the last durably stored record and retry with bounded exponential backoff and jitter. Stop advertising capacity if the access token expires before recovery.
- For rejected/invalid refresh credentials, set `reauth_required`, advertise no new authenticated capacity, and request a new operator attempt. Do not delete or log the old record automatically.
- For a storage, authentication-tag, permission, or disk-full failure, set `store_error`, advertise no authenticated capacity, and preserve the files for local diagnosis. Never fall back to plaintext.

OpenAI documents that ChatGPT sessions refresh automatically during use, but this implementation relies on Pi's current refresh contract and must pin/test that behavior when Pi is upgraded ([OpenAI login caching](https://developers.openai.com/codex/auth.md#login-caching)).

## Restart, failure, revocation, and recovery

| Condition | Required behavior | Operator recovery |
| --- | --- | --- |
| Normal service/host restart | systemd decrypts the store key at activation; Runner authenticates the local ciphertext and performs an auth preflight before advertising capacity | None |
| Restart during device authorization | Private polling state is deliberately not persisted; report the old attempt `interrupted` after reconnect | Start a fresh attempt and code |
| Control-plane restart/outage | Runner continues a locally active attempt; on reconnect it sends the latest snapshot. Codes already expired are cleared | Reopen the private view; restart only if terminal |
| Missing credential | Start with `reauth_required`, zero authenticated capacity | Start device reauthentication |
| Missing/wrong systemd host or store key | Fail service activation or enter `store_error`; never generate a replacement automatically | Repair permissions if appropriate. If the key is lost, initialize a new store key and reauthenticate; do not copy another Runner's key or token |
| Corrupt/tampered OAuth ciphertext | AEAD verification fails closed; preserve/quarantine locally, zero capacity, no overwrite | Diagnose disk/permissions locally, then explicitly initialize a new empty store and reauthenticate |
| Crash during refresh write | Atomic replacement yields the old or new complete ciphertext | Restart; if the old refresh token was already invalidated and refresh fails, reauthenticate |
| Device timeout/cancel/provider denial | Terminalize the attempt with a sanitized enum; retain any prior valid credential unchanged | Retry only with a new attempt ID |
| Operator local revoke | Abort refresh, delete the provider record idempotently, clear in-memory credentials best-effort, set `reauth_required`, and stop new Jobs | Reauthenticate that Runner to restore capacity |
| Suspected token, Runner, root, or disk compromise | Local deletion is not proof of provider-side revocation or SSD erasure | Use OpenAI account-level security/session revocation, rebuild or repair the host, rotate Runner transport credentials, and independently reauthenticate every affected Runner |
| Host replacement | Do not restore or copy the credential/store key to the new host | Enroll it as a new Runner, generate a new local store key, and complete a new device flow |

Pi exposes local credential deletion, and OpenAI documents `logout` as clearing stored local credentials; neither cited contract establishes that deleting Pi's local record revokes an already copied refresh token at the provider ([Pi credential-store delete contract](https://github.com/earendil-works/pi/blob/da840b6216578c2a571d0374ac6a2091a83f9d91/packages/ai/src/auth/types.ts), [OpenAI sign out](https://developers.openai.com/codex/auth.md#check-authentication-or-sign-out)). Consequently, `credential.revoke_local` means exactly local removal. A compromise response must additionally use OpenAI's current account-level security controls.

Do not back up a Runner credential for portability. Loss is recovered by reauthentication. If disaster recovery backs up the encrypted state and systemd host key together, that backup has the same offline-root limitation as the host and must be protected as a reusable model credential.

## Logging and error rules

- Redact by construction: event DTOs have no fields for tokens, JWTs, account IDs, provider request/response bodies, device authorization IDs, authorization codes, PKCE values, or store plaintext.
- The user code is allowed only in the private `reauth.instructions` response and ephemeral control-plane interaction state. It is forbidden in structured logs, traces, metrics, D1 history after expiry, R2 artifacts, GitHub messages, and support bundles.
- Map provider errors to an allowlist such as `network`, `provider_unavailable`, `authorization_pending`, `denied`, `expired`, `invalid_credential`, and `internal`. Never forward Pi's raw exception text because current OAuth exceptions may contain response bodies.
- Disable core dumps for the Runner service. Do not include process environment, `/run/credentials`, Runner state, or `/var/lib/systemd` in diagnostic archives.

## Implementation and acceptance checks

The first deployment is ready when these checks pass:

1. Create the store key through a stdin/stdout pipeline so plaintext never lands on disk, encrypt it explicitly with `--with-key=host`, install the encrypted output root-only, and verify the service can read it only through `$CREDENTIALS_DIRECTORY`. This is operator setup, not a runtime action.
2. Start with an empty store, complete device authorization through the private control-plane view, restart the Runner and the host, and prove capacity returns without another operator action.
3. Force concurrent expired-token requests and prove exactly one refresh mutation wins and the full new access/refresh pair is durably stored.
4. Inject crashes before write, after file `fsync`, after rename, and before directory `fsync`; every restart must produce one authenticated complete record or a closed `store_error`, never partial JSON/plaintext.
5. Use canary values for every forbidden OAuth field and assert none appears in control-plane requests, Runner events, logs, traces, metrics, artifacts, GitHub messages, or container mounts.
6. From a job container, prove that the Runner UID/process, credential directory, state directory, systemd host key, Docker host filesystem, and environment are unavailable.
7. Restart both sides during a pending attempt; prove the old attempt becomes `interrupted` or resumes only while the original Runner still holds its in-memory polling state, and that no second active code is created accidentally.
8. Test invalid refresh, network outage, disk full, wrong key, corrupted tag, duplicate revoke, and lost host key. Each must advertise zero authenticated capacity and follow the recovery matrix.
9. Verify terminal/expired user codes are cleared from control-plane storage and never enter GitHub.

## Upgrade path

When `homeserv1` gains a usable TPM2, re-encrypt only the store key with systemd's `host+tpm2` mode and retest recovery across normal firmware/kernel updates. systemd 255 defaults TPM2 credentials to PCR 7, so the PCR policy and recovery procedure must be deliberately tested rather than accepted implicitly ([systemd-creds TPM2 options](https://www.freedesktop.org/software/systemd/man/255/systemd-creds.html#--tpm2-pcrs=)). Adding LUKS to root storage is an independent host-hardening project.

Neither upgrade changes the Pi `CredentialStore`, the ciphertext format, or the control-plane protocol. A different Runner still performs a separate device authorization and receives a different store key, preserving ADR 0004's no-copy rule.
