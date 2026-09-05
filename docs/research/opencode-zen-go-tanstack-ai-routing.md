# OpenCode Go with TanStack AI for flow routing

Checked on 2026-09-05 against the current OpenCode, TanStack AI, and Cloudflare documentation.

## Conclusion

**Technically, yes.** A Cloudflare Worker can call OpenCode Go directly through TanStack AI. OpenCode publishes API endpoints for Go and explicitly permits clients other than OpenCode. For the simplest integration, use a Go model exposed through the OpenAI Chat Completions protocol and TanStack AI's generic OpenAI-compatible adapter.

This would make spend predictable only in the narrow sense that the subscription costs $10 per month when Zen balance fallback is disabled. Capacity is not fixed. Go applies rolling five-hour, weekly, and monthly usage allowances, calculates consumption by model price, and says that limits and the model list may change.

There is also a terms question worth resolving before Ornn relies on Go for unattended production routing. The product documentation permits other coding agents, but the general Terms contain broad restrictions on unattended processes and programmatic extraction. The initial single-operator use is probably closer to the documented "internal use" case, but that is an inference, not a contractual clearance.

## Verified facts

### Go is an API-backed subscription, not an OpenCode-client-only feature

OpenCode Go costs $10 per month. The setup creates an API key in the OpenCode console. OpenCode says Go may be used with OpenCode or "any agent," and its detailed documentation says it is designed for OpenCode and other coding agents that send similar requests. Third-party clients must identify themselves, avoid abusive traffic, and send an `x-opencode-session` header. Only one member per workspace can subscribe. [OpenCode Go product page](https://opencode.ai/go), [OpenCode Go documentation](https://opencode.ai/docs/go/)

OpenCode publishes these API families under the base URL `https://opencode.ai/zen/go/v1`:

- OpenAI Chat Completions at `/chat/completions` for GLM, Kimi, DeepSeek, MiMo, LongCat, Hy, and Omen models.
- OpenAI Responses at `/responses` for the currently listed GPT, Grok, and Muse models.
- Anthropic Messages at `/messages` for the currently listed MiniMax and Qwen models.
- A model catalog at `/models`.

The exact model list is mutable. [OpenCode Go endpoints](https://opencode.ai/docs/go/#endpoints)

Authentication uses the API key copied from the OpenCode console. For the OpenAI-compatible path, TanStack AI passes its `apiKey` into the official OpenAI JavaScript client, which sends standard bearer authentication. OpenCode's own endpoint table labels these models for an OpenAI-compatible SDK. [TanStack AI compatible adapter source](https://github.com/TanStack/ai/blob/main/packages/ai-openai/src/compatible/index.ts), [OpenCode Go endpoints](https://opencode.ai/docs/go/#endpoints)

### TanStack AI can call it from a Worker

TanStack AI does not have a dedicated OpenCode Go inference adapter. Its `openaiCompatible` adapter accepts a custom `baseURL`, API key, model list, and request headers. It calls `{baseURL}/chat/completions` by default and can instead target `{baseURL}/responses`. [TanStack AI OpenAI-compatible adapter](https://tanstack.com/ai/latest/docs/adapters/openai-compatible)

The adapter uses the official OpenAI JavaScript client. That client lists Cloudflare Workers as a supported runtime. Workers can make outbound HTTP requests with `fetch`. [OpenAI JavaScript runtime support](https://github.com/openai/openai-node#requirements), [Cloudflare Workers Fetch API](https://developers.cloudflare.com/workers/runtime-apis/fetch/)

The practical Chat Completions configuration is:

```ts
const go = openaiCompatible({
  name: "opencode-go",
  baseURL: "https://opencode.ai/zen/go/v1",
  apiKey: env.OPENCODE_GO_API_KEY,
  models: ["glm-5.3-flash"],
  defaultHeaders: {
    "x-opencode-session": invocationId,
    "User-Agent": `ornn-forge/${version}`,
  },
})
```

Constructing this provider per routing request makes the session header job-specific and follows Cloudflare's advice for clients that hold rotatable secrets.

TanStack AI supports schema-validated output, but OpenCode does not document which Go models accept OpenAI's `response_format.json_schema`. That exact path remains unverified without a Go key. The first integration test should check native structured output for the selected model. If it rejects the schema option, ask for JSON in the prompt and validate it locally, treating malformed or ambiguous output as `clarification_required`. [TanStack AI structured outputs](https://tanstack.com/ai/latest/docs/structured-outputs/overview), [TanStack AI model declarations](https://tanstack.com/ai/latest/docs/adapters/openai-compatible#declaring-models)

### Cost is capped, but throughput is variable

Go documents base allowances of $12 per five hours, $30 per week, and $60 per month. Allowances vary by model. The published request counts are estimates based on coding-agent prompts with large cached prefixes, so they do not predict Ornn's short classification calls. Go says usage limits may change. [OpenCode Go usage limits](https://opencode.ai/docs/go/#usage-limits)

When a limit is reached, requests stop unless the account enables "Use balance." That option falls back to the separate pay-as-you-go Zen balance. Therefore:

- Go with balance fallback disabled gives Ornn a $10 monthly ceiling, plus the risk of temporary routing failure when any quota window is exhausted.
- Enabling balance fallback improves availability but removes the hard $10 ceiling.

The current catalog includes high-allowance Chat Completions models such as MiMo-V2.5, LongCat-2.0, and GLM-5.3-Flash. Model quality for Ornn's routing schema still needs a small evaluation set. Published request counts alone cannot select the router. [OpenCode Go limits and model pricing](https://opencode.ai/docs/go/#usage-limits)

### Credentials and policy caveats

Store the Go API key as a Cloudflare Worker secret and instantiate the provider inside the request or workflow handler. Do not put the key in source, GitHub comments, workflow records, browser code, or sandbox inputs. Unlike the Workers AI binding, this is a reusable bearer credential visible to the control-plane Worker code. Cloudflare documents encrypted Worker secrets for this case. [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

OpenCode documents manual account sign-in and API-key creation. It does not document workload identity, service accounts, short-lived routing tokens, or automated key renewal for Go. A revoked key therefore needs an operator-driven secret rotation.

The hosted service is governed by OpenCode's Terms, not the MIT license of the client libraries. The Terms limit use to the customer's internal use and contain broad prohibitions covering programmatic extraction and processes that run while the user is not logged in. Those clauses sit awkwardly beside the Go API and "use with any agent" documentation. Before exposing Ornn routing to other users or relying on it as an unattended production dependency, ask OpenCode to confirm in writing that this control-plane use is allowed. [OpenCode Terms of Use](https://opencode.ai/legal/terms-of-service)

OpenCode also publishes model-specific retention terms. Several suitable Chat Completions candidates currently state no training and zero-day retention, while the discounted Muse Contributor models permit training and are not zero-data-retention. Pin an approved model and fail closed if it disappears rather than silently routing issue content to another model. [OpenCode Go privacy table](https://opencode.ai/docs/go/#privacy)

## Recommendation for Ornn

Use OpenCode Go as an optional `FlowRouter` provider behind the same Ornn-owned interface proposed for Workers AI. Start with one zero-retention Chat Completions model, disable Zen balance fallback, send a stable Ornn user agent and a per-invocation `x-opencode-session`, and store the key only in a Worker secret. Add a deterministic failure path that asks for clarification when the provider is unavailable, quota-limited, or returns invalid output.

This is a credible low-cost experiment. It is not yet a dependable production default because capacity and model availability can change, native schema support is unverified, and the unattended-use language in the Terms needs clarification.
