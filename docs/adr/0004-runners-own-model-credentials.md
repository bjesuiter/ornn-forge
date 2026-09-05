# Runners own personal model credentials

The control plane will host the operator-facing reauthentication experience, but each Remote Runner will independently perform OpenAI device authorization and store and refresh its own personal subscription credential. The control plane may relay the verification URL, one-time code, expiry, and completion status, but it will never receive a reusable OpenAI credential. Credentials will not be copied between Runners or exposed to sandboxes. This provides browser-based reauthentication without SSH while avoiding a central personal-credential vault and cross-Runner refresh races.

On the first `homeserv1` Runner, systemd will decrypt a host-key-encrypted store key into the service credential directory. An Ornn implementation of Pi's `CredentialStore` will use that key to encrypt the mutable OAuth record with AES-256-GCM and replace the ciphertext atomically after refresh. The Runner will not use Pi's plaintext `auth.json` store. See [the storage and reauthentication research](../research/runner-credential-storage-and-reauthentication.md).

## Consequences

The Runner protocol needs authenticated commands and events for starting, cancelling, and observing a reauthentication attempt. A Runner without a valid credential cannot offer Pi capacity until the operator completes reauthentication. Supporting a new Runner requires a separate authorization interaction, even when it uses the same ChatGPT account.

The first host has TPM 1.2 and an unencrypted ext4 root filesystem. Host-key encryption protects the Runner boundary and accidental file disclosure, but it does not protect against root compromise or offline theft of the whole disk. LUKS or TPM2 sealing is later host hardening and does not block the personal first version.
