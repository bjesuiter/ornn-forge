# Ornn Forge

The first control-plane slice admits a signed GitHub `issue_comment` delivery from
`bjesuiter`, or an `issues` delivery where `bjesuiter` opens or edits an issue
description to mention `ornn-forge`. It transactionally creates an Invocation and
pending Analyze Job in D1, then exposes that Job to the single authenticated operator.

The GitHub App must subscribe to both **Issue comment** and **Issues** events.

## D1 setup and deployed smoke check

Provision a dedicated D1 database named `ornn-forge` in the intended Cloudflare
account and apply the checked-in migration before deploying. The committed
`ORNN_D1` binding points to that name:

```sh
wrangler d1 migrations apply ornn-forge --remote
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put OPERATOR_BEARER_SECRET
wrangler secret put ORNN_RUNNER_CREDENTIAL_SECRET
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY < /secure/path/to/github-app-private-key.pem
```

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
