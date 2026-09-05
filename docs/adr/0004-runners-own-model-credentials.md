# Runners own personal model credentials

The control plane will host the operator-facing reauthentication experience, but each Remote Runner will independently perform OpenAI device authorization and store and refresh its own personal subscription credential. The control plane may relay the verification URL, one-time code, expiry, and completion status, but it will never receive a reusable OpenAI credential. Credentials will not be copied between Runners or exposed to sandboxes. This provides browser-based reauthentication without SSH while avoiding a central personal-credential vault and cross-Runner refresh races.

## Consequences

The Runner protocol needs authenticated commands and events for starting, cancelling, and observing a reauthentication attempt. A Runner without a valid credential cannot offer Pi capacity until the operator completes reauthentication. Supporting a new Runner requires a separate authorization interaction, even when it uses the same ChatGPT account.
