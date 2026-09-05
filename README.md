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
```

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
