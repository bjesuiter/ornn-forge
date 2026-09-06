# Ornn Forge

The first control-plane slice admits a signed GitHub `issue_comment` delivery from
`bjesuiter`, or an `issues` delivery where `bjesuiter` opens or edits an issue
description to mention `ornn-forge`. It transactionally creates an Invocation and
pending Analyze Job in D1, then exposes that Job to the single authenticated operator.

The GitHub App must subscribe to both **Issue comment** and **Issues** events,
and its installation must grant **Issues: Read and write** repository access.

## Local Dashboard login

The development profile keeps the Dashboard's OAuth secrets in macOS Keychain,
with portable resolver references committed in [`.env.development`](.env.development).
Configure a second callback URL on the GitHub App:

```
http://localhost:3000/api/auth/callback/github
```

Then set the two local secrets interactively; neither command prints the value:

```sh
bunx varlock keychain set BETTER_AUTH_SECRET --project ornn-forge --profile development --write-to .env.development
bunx varlock keychain set GITHUB_CLIENT_SECRET --project ornn-forge --profile development --write-to .env.development
```

Generate a unique value for `BETTER_AUTH_SECRET` with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`, then paste it into the first prompt. Paste the second GitHub App client secret into the second prompt. Start the local Dashboard with:

```sh
bun run dev
```

## D1 setup and deployed smoke check

Provision a dedicated D1 database named `ornn-forge` in the intended Cloudflare
account. The committed `ORNN_D1` binding points to that name:

```sh
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put OPERATOR_BEARER_SECRET
wrangler secret put ORNN_RUNNER_CREDENTIAL_SECRET
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY < /secure/path/to/github-app-private-key.pem
```

## OpenAI subscription usage in the dashboard

The dashboard can show the remaining five-hour and weekly allowance for the
Operator's ChatGPT subscription without consulting a Runner or a local machine.
It has a deliberately separate, telemetry-only OAuth connection; it cannot be
used for Runner work, sandboxes, or OpenAI Platform API calls.

Create an account-level Cloudflare Secrets Store secret containing a random
256-bit base64url value. Do not use `--value`, which leaves a secret in shell
history:

```sh
wrangler secrets-store store create ornn-forge-secrets --remote
wrangler secrets-store secret create STORE_ID --name ORNN_D1_SECRETS_ENCRYPTION_KEY --scopes workers --remote
```

At the value prompt, paste the output of `openssl rand -base64 32 | tr '+/'
'-_' | tr -d '='`. Bind that secret to the Worker as
`ORNN_D1_SECRETS_ENCRYPTION_KEY` (Worker Settings → Bindings → Secrets Store),
using the `STORE_ID` returned above and the same secret name. The binding is
intentionally not committed because its store ID is account-specific.

After deploy, open the authenticated dashboard, choose **OpenAI verbinden**,
open the displayed OpenAI link, and enter the displayed one-time code. The
browser never receives OAuth tokens. The Worker encrypts them with the Secrets
Store key before storing the rotating record in D1. The one-minute refresh stores
only plan, credits when provided, five-hour/weekly percentage, reset timestamps,
and check time; neither account ID nor raw OpenAI response reaches D1, the
browser, or logs. **Verbindung trennen** removes the ciphertext and snapshot.

This uses the same ChatGPT/Codex subscription endpoint approached by Codex
clients, rather than the documented Platform API usage endpoint. Treat it as a
best-effort integration that may require reauthorization or an update if OpenAI
changes that endpoint. OpenAI documents ChatGPT sign-in and device-code auth
for Codex clients, and advises treating the resulting auth cache like a password.
The resulting credential boundary is recorded in
[ADR 0008](docs/adr/0008-centralize-openai-subscription-usage.md).

Deploy with one command:

```sh
bun run deploy
```

The deploy script builds the Worker, applies every pending remote D1 migration,
then deploys while preserving Dashboard-set variables. It loads the Cloudflare
API token from the `ops` Varlock profile.

Set `ORNN_RUNNER_CREDENTIAL_ID` as a non-secret Worker variable and provision the
same 256-bit `ORNN_RUNNER_CREDENTIAL_SECRET` only to the `homeserv1` Runner. The
Runner polls outward; it never needs an inbound endpoint:

```sh
ORNN_CONTROL_PLANE_URL=https://ornn-forge.example \
ORNN_RUNNER_ID=runner_homeserv1 \
ORNN_RUNNER_CREDENTIAL="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" \
bun run runner:fixture
```

`GITHUB_APP_ID` is the GitHub App ID from the App settings page, not its OAuth
client ID. `GITHUB_APP_PRIVATE_KEY` is a private key generated in the App's
**Private keys** section, not an OAuth client secret. For each control-plane
request that publishes an Ornn message, the Worker signs an App JWT, exchanges
it for a repository-scoped installation token with `issues: write`, and uses
that short-lived token to call GitHub. Ornn records its opaque message ID,
effect key, comment identity, and publication attempt in D1; a retry finds the
known message before it edits and does not create another message.

`OPERATOR_BEARER_SECRET` is a 256-bit secret, supplied either as 32 raw bytes or
as a 43-character base64url value. Generate the latter with:

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Set the non-secret GitHub installation/repository values in the Worker environment.
After deployment, run the explicit Cloudflare-runtime admission/inspection proof:

```sh
bun run test:smoke:d1
```

It requires the `ORNN_SMOKE_*` variables named in
[`scripts/smoke-deployed-d1.ts`](scripts/smoke-deployed-d1.ts). The check signs a
fresh fixture delivery, verifies that D1 admits it transactionally, and immediately
inspects the created pending Job through the deployed Worker.

## Local Runner debug container

The Runner can be enrolled locally without installing Bun or the Runner on the
host. It is a development test harness, not a `homeserv1` deployment. Start
OrbStack (macOS) or the local Docker Engine (Linux), then enroll a Runner with
the one-time Setup token shown by the Control Plane:

```sh
bun run runner:setup
```

Setup prompts without echoing the token, preflights it before creating a
credential, then sends only the credential's SHA-256 digest to the Control
Plane. It stores the raw credential in macOS Keychain through Varlock and writes
the public Runner ID to [`.env.runner-debug`](.env.runner-debug); neither is
written to shell history. It then starts the debug Runner and reports success only
after its authenticated control connection synchronizes.
The deployed control-plane and Runner setup handshake can be smoke-tested with
`bun run test:smoke:runner-setup` after loading the `ORNN_SMOKE_*` environment.

The debug Runner keeps a reconnecting fixture control connection:

```sh
bun run runner:debug -- --root run --rm runner
```

Stop the background debug service and remove only its local Compose state with:

```sh
bun run runner:debug -- down --volumes
```

The launcher uses only the active Docker context's Unix socket and refuses TCP,
SSH, or unavailable endpoints. Compose turns the Varlock-provided value into an
in-memory Docker secret mounted only at `/run/secrets/runner_credential`; it is
not a container environment variable. The checkout is mounted into the Runner
for watch mode, but Job sandboxes never receive the host checkout, Docker
socket, Runner state, or credential. Use `--root` only as the explicit OrbStack
fallback when its forwarded socket cannot be read by the container's normal
`bun` user.
