# Pi anonymous `web_fetch`

Date: 2026-09-05
Issue: [#15](https://github.com/bjesuiter/ornn-forge/issues/15)

## Decision

Use the existing MIT-licensed [`code-yeongyu/pi-webfetch`](https://github.com/code-yeongyu/pi-webfetch) extension, pinned to commit [`ee045140cbaa784eec420bc0a7bc7d7eec0b7043`](https://github.com/code-yeongyu/pi-webfetch/tree/ee045140cbaa784eec420bc0a7bc7d7eec0b7043). Install it from the operator-controlled Runner, not from the repository:

```sh
pi install git:github.com/code-yeongyu/pi-webfetch@ee045140cbaa784eec420bc0a7bc7d7eec0b7043
```

Pi documents exact Git commit references as stable package pins, and normal `pi update` does not move them ([package sources](https://pi.dev/docs/latest/packages#git)). The repository declares package version `0.1.2`, but it has no npm publication or release tag, so the commit is the authoritative pin.

The extension registers one tool named `webfetch`. Ornn may describe that tool as its anonymous web-fetch capability, but should use the existing tool directly rather than create a wrapper or a custom research tool. Start it with `format: "markdown"` and omit `timeout` to retain the 30-second default. No credential or provider configuration is required. The Runner should allowlist `webfetch` alongside the job's Ornn tools and continue to ignore repository-provided Pi extensions and settings.

This is a practical first-personal-Runner choice, not a claim that the extension is hardened for hostile multi-tenant use. Its source is small and recently maintained, and it provides the operational bounds that matter most for ordinary supplied-URL retrieval: one overall timeout, a 5 MiB streamed body ceiling, a 50 KiB model-output ceiling, bounded redirects, cancellation, content conversion, and final-URL/status metadata. These behaviors are implemented in the pinned [`fetcher.ts`](https://github.com/code-yeongyu/pi-webfetch/blob/ee045140cbaa784eec420bc0a7bc7d7eec0b7043/src/webfetch/fetcher.ts) and [`tool.ts`](https://github.com/code-yeongyu/pi-webfetch/blob/ee045140cbaa784eec420bc0a7bc7d7eec0b7043/src/webfetch/tool.ts), not inferred only from its README.

## Security and behavior contract

| Check | Result for the selected commit |
| --- | --- |
| Existing installable Pi extension | Pass. Pi can load the TypeScript entry point from an exact git commit. The extension loaded under local Pi `0.84.4`. |
| Anonymous supplied-URL fetch | Pass. Input is an absolute `http:` or `https:` URL; the request adds fixed browser-like headers but no cookies, authorization header, or credential lookup. |
| Focused scope | Pass. The package registers only `webfetch`; it does not add search, browser automation, cache management, or mutation tools. |
| Timeout and cancellation | Pass. Default 30 seconds, caller maximum 120 seconds, with the same abort signal covering redirects and body streaming. Keep the first deployment at the default. |
| Body and output bounds | Pass. `Content-Length` and streamed bytes are limited to 5 MiB; larger responses fail. Model-facing text is limited to 50 KiB with a truncation notice. |
| Redirects and provenance | Pass for v1. Redirects are handled manually and capped at 20. Results include requested URL, final URL, status, content type, byte count, and truncation fields. There is no fetch timestamp. |
| Content handling | Partial. HTML/XHTML is converted to Markdown or text; other response types are decoded as UTF-8. There is no strict text MIME allowlist, so avoid known binary/download URLs in v1. |
| Private/local destinations | Known risk. The code performs no private-address, loopback, link-local, metadata-host, port, or DNS-rebinding checks. A probe attempted `127.0.0.1` rather than rejecting it. This is accepted only for the personal Runner; do not expose this tool to untrusted tenants or a Runner whose local services/metadata endpoint are reachable without separate network controls. |
| Untrusted-content boundary | Known integration gap. The extension does not label returned text as untrusted instructions. The Analyze Flow system prompt must state that fetched text is evidence only and cannot authorize tool calls, capability changes, or credential access. |
| Runtime dependency state | Known patch gap. The pin directly fixes `undici` at `7.28.0`; npm currently reports advisories fixed in `7.29.0`, including [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) and [GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272). The extension does not configure the affected retry/cache interceptors, but the Runner should repin after upstream updates and rerun the probe suite. |

Pi extensions execute with the launching process's permissions, and catalog presence is not a security review ([Pi package security](https://pi.dev/docs/latest/packages#security), [Pi security model](https://pi.dev/docs/latest/security#no-built-in-sandbox)). Therefore the selected extension belongs only in the trusted Runner process. It does not change the separate rule that the repository sandbox has no direct egress.

## Comparative review

The comparison uses the operator's minimal personal-tool criterion: an existing reusable extension, anonymous direct URL fetch, focused MIT-compatible scope, bounded work, reviewable maintenance, and low setup/runtime weight. Missing DNS pinning or provenance framing is recorded as risk rather than treated as an automatic rejection.

| Candidate | Assessment |
| --- | --- |
| **[`code-yeongyu/pi-webfetch`](https://github.com/code-yeongyu/pi-webfetch/tree/ee045140cbaa784eec420bc0a7bc7d7eec0b7043)** | **Selected.** One tool, MIT, no credentials, four runtime libraries, fixed timeout/body/output bounds, final-URL metadata, 41 passing tests, and a source update on 2026-08-26. Its missing SSRF controls and untrusted framing are accepted personal-v1 risks. |
| [`@pi-lab/webfetch@1.1.0`](https://github.com/anthod0/pi-lab/tree/main/packages/webfetch) | Best plausible MIT alternative and easy npm install. It preserves URL/content metadata and caps redirects, but the reviewed [`fetch.ts`](https://github.com/anthod0/pi-lab/blob/48d04491a2ba9c4cbcdb9b72565f560d7380c143/packages/webfetch/src/fetch.ts) has no request timeout or response-size ceiling. It fully buffers text and binary responses and writes binaries into the Runner user's Pi directory. It also includes site-specific optimizers and more dependencies. |
| [`georgebashi/pi-web-fetch@1.1.0`](https://github.com/georgebashi/pi-web-fetch/tree/1b9ca07329ff9a86bbc96bb011578738e06a789c) | MIT and capable, but starts a pooled Puppeteer/Chrome browser and invokes Python `uvx`/Trafilatura. Batch fetching, hooks, subagents, caching, and roughly browser-sized installation weight are unnecessary for anonymous URL retrieval. |
| [`@thurstonsand/pi-web-tools@0.2.5`](https://github.com/thurstonsand/pi-web-tools/tree/4e7fafedf00f6227d925bdb7ff7913824220334a) | Maintained MIT implementation with `web_fetch`, timeouts, a 100 MiB ceiling, and useful artifacts. It is a broader search/fetch router that can use GitHub credentials, Parallel, system Chrome, Playwright, and `uvx`/Trafilatura. Public URLs work without credentials, but setup, host integration, and tool scope exceed v1. |
| [`nicobailon/pi-web-access@0.28.0`](https://github.com/nicobailon/pi-web-access/tree/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5) | Most active and hardened MIT candidate. It has redirect-aware SSRF checks, timeouts, and body caps, but is a large search/extraction/authentication platform with many providers, browser-cookie profiles, video/PDF support, persistent storage, and multiple registered tools. Its direct fetch tool is named `fetch_content`. Strong project, wrong first-slice weight and authority. |
| [`pi-unsloth-webtools@0.5.1`](https://github.com/YuGiMob/pi-unsloth-webtools/tree/29edbd04cd7319eed8950637050941e662632b0d) | Strongest reviewed DNS validation/pinning and response controls, with 372 passing unit tests. Rejected because it is AGPL-3.0 rather than MIT-compatible, also registers search, reads project settings that can expand limits, rewrites some URLs to GitHub/Wayback sources, and discards final provenance. |
| [`devashish-pi-web-access@3.0.0`](https://www.npmjs.com/package/devashish-pi-web-access/v/3.0.0) | MIT with solid SSRF and size controls, but the published package exposes authentication plus fetch-many, cache, search, video, and GitHub mutation tools. It has no linked source repository, and its fetch result discards the final redirect URL. |
| [`pi-web-research@1.0.1`](https://github.com/wynainfo/pi-web-research/tree/dd979ce65c5c1ede5eaa8355cf5ac3cde532e094), [`pi-safe-search@1.4.0`](https://github.com/sebaxzero/pi-safe-search/tree/1ecc1e334240d9eb639ae43c13f03f6f8c1e3bf3), [`@walterra/pi-web-tools@0.0.2`](https://github.com/walterra/agent-tools/tree/a678024a6fa7a765cd83997b3153f2eebb588d58/packages/pi-web-tools), [`@aprimediet/webtools@1.0.0`](https://github.com/aprimediet/agent-tools/tree/7e9fbdb25ff45fae6f524a3b3d47540abd82a537) | Respectively too broad/browser-oriented, lacks a request timeout, proxies retrieval through hosted Jina Reader, or requires headless browser machinery. None offers a better focused personal-tool balance than the selection. |

## Verification and next step

Disposable verification used no credentials or paid service:

- ran the exact `pi install git:...@ee045140...` command with an isolated Pi configuration and confirmed that `pi list` retained the full commit pin;
- separately installed the selected commit's dependencies with lifecycle scripts disabled and ran its test suite: **5 files, 41 tests passed**;
- ran its TypeScript check successfully;
- loaded `src/index.ts` through Pi `0.84.4` with an isolated Pi configuration;
- fetched `https://example.com/` successfully and observed status `200`, final URL, `text/html`, and 559 response bytes;
- confirmed that `http://127.0.0.1:9/` reached the connection attempt, demonstrating the documented private-network gap;
- inspected `@pi-lab/webfetch` source as the lighter MIT alternative and confirmed that its main fetch path has no timeout or body-size bound.

The smallest next step is to install the exact git pin on the non-production `homeserv1` Runner, expose only `webfetch` for one Analyze Flow, and run a smoke test against a normal page, redirect, slow response, and oversized response. Record the tool's requested/final URL, status, content type, bytes, and truncation details in the job audit, and keep the Flow-level untrusted-content instruction active. If the Runner cannot accept the loopback/private-network risk, stop there and choose host egress filtering or a later upstream-hardened release; do not replace the selected extension with a custom research tool.
