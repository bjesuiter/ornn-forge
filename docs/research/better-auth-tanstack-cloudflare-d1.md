# Better Auth with TanStack Start, Cloudflare Workers, and D1

Research date: 2026-09-06

## Question

Can the existing Ornn Forge TanStack Start Worker use Better Auth, GitHub OAuth,
and its bound D1 database to admit a small, server-configured set of Operators
to a browser-only dashboard, without changing the existing API bearer-auth
boundary?

## Decision

Yes. Use Better Auth 1.5 or later with its built-in D1 support, mounted at the
default `/api/auth/*` route in the existing TanStack Start application. Use the
GitHub provider, a fixed production Worker origin, and Better Auth's
`validateUserInfo` hook to compare GitHub's stable numeric user ID to a
server-side allowlist. The initial browser area is independent of the existing
operator bearer credentials; Better Auth supplies login sessions, not API
credentials or their association to an Operator.

This is implementation-ready once the OAuth App is registered and the
deployment/migration contract is selected. It does not require Drizzle or a
separate database.

## Evidence

### Framework and runtime fit

The repository already uses the Vite plugin order documented by both TanStack
Start and Cloudflare for a TanStack Start Worker: Cloudflare's SSR Vite
environment, `tanstackStart()`, then React. Its Worker also already declares
`nodejs_compat`. That is significant because Better Auth's Cloudflare guidance
requires Node AsyncLocalStorage support; `nodejs_compat` supplies it. [TanStack
Start hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting),
[Cloudflare's TanStack Start guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/),
and [Better Auth installation](https://better-auth.com/docs/installation)
document that setup.

Better Auth's first-party TanStack Start integration mounts `auth.handler` from
a catch-all `/api/auth/$` server route for both GET and POST. It recommends the
client SDK for browser login and its `tanstackStartCookies()` plugin as the last
plugin when server-side code must set cookies. The documented protected-route
pattern is a server function that passes request headers to
`auth.api.getSession`, followed by a route `beforeLoad` redirect for an absent
session. [Better Auth's TanStack Start integration](https://better-auth.com/docs/integrations/tanstack)
defines these integration points.

### D1 and schema ownership

Better Auth 1.5 added native Cloudflare D1 support: passing a `D1Database`
binding directly as `database` auto-selects its built-in adapter. It uses D1's
batch API for atomic work, because D1 has no interactive transactions. [Better
Auth 1.5](https://better-auth.com/blog/1-5) documents the adapter and
transaction boundary.

Better Auth's core schema adds `user`, `session`, `account`, and `verification`
tables. The checked-in Ornn migrations do not use those names, so there is no
current table-name collision. Better Auth identifies an external account by the
provider/account-ID pair; its `accountId` is the stable identifier supplied by
the provider. [Better Auth database schema](https://better-auth.com/docs/concepts/database)
documents both facts.

D1 is only queryable through a Worker, so Better Auth explicitly says its Node
CLI cannot directly migrate D1. Its supported alternative is
`getMigrations(auth.options)` in a Worker, and its own example says the
migration endpoint must be protected or removed in production. The next
implementation ticket must choose and document one controlled way to run that
operation; it must not become an unauthenticated application endpoint. A
checked-in Ornn migration remains preferable as the audit artifact, even if a
restricted Worker command generates or applies it. [Better Auth D1 migrations](https://better-auth.com/docs/concepts/database)
supports the first two statements; the checked-in-migration recommendation is
an Ornn operational inference.

Cloudflare permits importing `env` from `cloudflare:workers` at module scope,
which lets one configured Better Auth instance use `env.ORNN_D1` and secret
bindings. I/O still has to occur during request handling. This is compatible
with Better Auth's handler model. [Cloudflare bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
documents the scope and I/O constraint.

### GitHub sign-in and admission policy

Better Auth has a built-in GitHub provider. The login button can call
`authClient.signIn.social({ provider: 'github', callbackURL: '/dashboard' })`.
The default callback path is `/api/auth/callback/github`; Better Auth says the
GitHub app needs email access and its provider requests `read:user` and
`user:email` by default. [Better Auth's GitHub provider guide](https://better-auth.com/docs/authentication/github)
and [OAuth options](https://better-auth.com/docs/reference/options) define
these details.

GitHub permits an OAuth App owned by a personal account or an organization, so
ownership by the `bjesuiter` personal account is supported. Register the public
homepage and the exact deployed callback URL; GitHub allows up to ten callback
URLs, but this first deployment needs only the existing Worker's production
origin. [GitHub's OAuth App creation guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
documents the ownership and registration rules.

Use `user.validateUserInfo` as the admission gate. It runs before account/user
creation, before account linking, and again on subsequent OAuth sign-ins; its
OAuth source includes the provider ID and raw profile. Better Auth's GitHub
provider defines its provider subject as `profile.id`, which is GitHub's stable
numeric identity rather than the mutable login name. Therefore compare
`String(source.oauth.profile.id)` only when the provider is `github` against a
comma-separated, Worker-side `DASHBOARD_OPERATOR_GITHUB_IDS` allowlist. Deny
every non-match before a session is issued. [Better Auth user and account
callbacks](https://better-auth.com/docs/concepts/users-accounts#callbacks)
and [the provider source](https://github.com/better-auth/better-auth/blob/main/packages/core/src/social-providers/github.ts)
support the gate and identifier choice.

Set `baseURL` (or `BETTER_AUTH_URL`) to the exact production Worker URL rather
than allowing request inference. Better Auth recommends explicit base URLs for
security and stable OAuth redirects; the base origin is trusted automatically.
Do not add a broad `*.workers.dev` trusted origin. Local development needs a
separate deliberate origin/callback strategy, not a production wildcard. [Better
Auth base-URL and trusted-origin options](https://better-auth.com/docs/reference/options)
define this behavior.

## Required implementation shape

- Add a direct, exact-pinned `better-auth` production dependency at version
  1.5 or later.
- Configure `BETTER_AUTH_SECRET` as a high-entropy Cloudflare secret of at
  least 32 characters; also configure `GITHUB_CLIENT_ID`,
  `GITHUB_CLIENT_SECRET`, the fixed `BETTER_AUTH_URL`, and the non-secret
  numeric-ID allowlist. Better Auth refuses a missing production secret and
  documents secret rotation support. [Better Auth installation](https://better-auth.com/docs/installation)
- Instantiate Better Auth against `env.ORNN_D1`; enable
  `account.encryptOAuthTokens` because its default is false. The GitHub OAuth
  token is not part of the dashboard feature and must not be stored in plaintext
  merely because identity login needs it. [Better Auth account options](https://better-auth.com/docs/reference/options)
  documents the default and encryption option.
- Mount the handler at `/api/auth/$`; add `/login` containing only the GitHub
  sign-in control; add a protected `/dashboard` that renders the placeholder;
  route both unauthenticated and rejected identities to a safe login/error
  state. Add sign-out through the Better Auth client.
- Leave every existing `/api/v1/*` bearer check in place. Associate legacy and
  future bearer credentials with the authenticated Operator only in Ornn-owned
  application data; Better Auth's session is not a substitute bearer token.

## Verification contract

Automated checks should prove that an allowed GitHub numeric ID can complete the
admission hook, any other ID cannot create a Better Auth user/session, the
dashboard redirects an absent session to `/login`, and existing bearer-token
API tests retain their present behavior. The deployment proof should then use
the real `bjesuiter` GitHub account to complete `/login` -> GitHub ->
`/dashboard`, sign out, and verify `/dashboard` redirects to `/login` again.
Run the restricted schema-migration operation before that proof and confirm
Better Auth's schema validation is clean.

## Limits and follow-up decisions

- D1's lack of interactive transactions excludes Better Auth plugins that
  require them. The planned simple GitHub social login does not require such a
  plugin; do not add SCIM or similar transactional plugins incidentally.
- The allowlist controls new OAuth sessions and re-checks returning OAuth
  sign-ins. It does not automatically revoke a browser session that was already
  issued; a future multi-operator policy should choose explicit session
  revocation when an ID is removed.
- Better Auth persists identity and session records, but has no knowledge of
  Ornn's `Operator` or `Operator bearer credential` domain concepts. The
  credential-to-Operator data contract, production migration procedure, and
  deployment secrets belong to the remaining dashboard-auth specification.
