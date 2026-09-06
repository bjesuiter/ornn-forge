# Centralize OpenAI subscription usage telemetry

## Status

Accepted

## Date

2026-09-06

## Context

The operator wants the dashboard to show the ChatGPT/Codex subscription's
five-hour and weekly allowance without relying on a particular Runner or a
local machine. The existing Runner boundary remains necessary: a Runner's
model credential must never become a control-plane credential or be exposed to
another Runner or a sandbox.

The consumer subscription endpoint used by Codex clients is not a documented
OpenAI Platform usage API. It can therefore change independently of Ornn.

## Decision

The Control Plane owns one *separate*, operator-authorized OAuth connection
whose sole purpose is subscription-usage telemetry. The authenticated Dashboard
starts the Codex device-code flow; the browser sees a verification URL and a
short-lived user code, but never an access or refresh token.

The OAuth record is AES-256-GCM encrypted before it reaches D1. The stable
256-bit encryption key is an account-level Cloudflare Secrets Store secret,
bound to the Worker as `ORNN_D1_SECRETS_ENCRYPTION_KEY`; D1 holds only the
ciphertext. This is Ornn's product-wide master key for encrypted D1 secrets,
not an OpenAI-specific key. A refresh worker reads that credential at most once per minute and
writes a narrow D1 snapshot: plan, credits when supplied, five-hour/weekly used
percentage, reset timestamps, and checked time. It does not persist an account
identifier or raw upstream response. The Dashboard reads only this snapshot.

The connection cannot be used by Runners, sandboxes, job execution, or OpenAI
Platform API calls. Revocation deletes the encrypted record, pending device
authorization, and snapshot from D1.

## Alternatives

### A local CodexBar-style observer

- **Pros:** No personal credential reaches the Control Plane.
- **Cons:** The dashboard depends on a machine being online and reachable.

### Persist the OAuth record directly in Secrets Store

- **Pros:** No ciphertext record in D1.
- **Cons:** A Worker would need account-level Secret Store edit authority to
  rotate a refresh token. Keeping the stable key in Secrets Store and the
  encrypted, rotating record in D1 has a narrower runtime permission boundary.

### Use the OpenAI Platform Usage API

- **Pros:** Documented API intended for organization API usage.
- **Cons:** It reports API billing, not the operator's ChatGPT/Codex
  subscription allowance.

## Consequences

### Positive

- Dashboard availability no longer depends on a local machine or Runner.
- The browser and observability logs receive only the narrow usage snapshot.
- Refresh-token rotation is durable and does not require Secret Store write
  credentials in the Worker.

### Negative

- The Control Plane now deliberately holds a reusable personal OAuth
  credential, albeit encrypted and limited to telemetry.
- The private subscription endpoint can change or stop working; the last safe
  snapshot remains visible, but a reauthorization or implementation update may
  be needed.
- The Secrets Store binding is a required deployment prerequisite.

## Related Decisions

- [0004](./0004-runners-own-model-credentials.md) still governs Runner model
  credentials. This decision adds a deliberately isolated telemetry-only
  credential and does not relax that Runner boundary.
