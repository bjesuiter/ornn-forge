# Cloudflare Workers AI router benchmark

Checked on 2026-09-05 against the current Cloudflare Workers AI catalog, pricing, native binding, and the same Ornn routing corpus used for the OpenCode Zen evaluation.

## Decision

Keep paid OpenCode Zen `gemini-3.5-flash-lite` as the first experimental `FlowRouter` model.

Cloudflare Workers AI is easier to integrate into Ornn's Cloudflare control plane, but none of the tested Workers AI models beat the Zen selection on the combined correctness, latency, and cost objective:

| Provider and model | Full pass | Median latency | p95 latency | Mean measured cost per route |
| --- | ---: | ---: | ---: | ---: |
| Zen `gemini-3.5-flash-lite` | 28/28 | 0.864 s | 1.016 s | $0.000180 |
| Workers AI `@cf/nvidia/nemotron-3-120b-a12b` | 28/28 | 3.910 s | 6.769 s | $0.000673 |
| Workers AI `@cf/zai-org/glm-5.3-flash` | 27/28 | 7.757 s | 30.077 s | $0.000199 |

Nemotron is the Workers AI fallback worth retaining. It is the only Workers AI candidate with a perfect two-pass result, but it was 4.5 times slower at the median and 3.7 times the measured route cost of Zen Gemini Lite. Cloudflare GLM nearly matched Zen's cost, but one response exhausted the 1,024-token allowance before emitting complete JSON and its median was about nine times slower.

Do not add a Workers AI provider abstraction solely for the first router. Keep the router's model/provider seam small enough to add the native binding later, and rerun this corpus when Cloudflare adds a materially faster cheap model or when avoiding the external Zen dependency becomes more valuable than the measured gap.

## Candidate selection

The screen considered current, relatively inexpensive, Cloudflare-hosted text models that advertise instruction following, function calling, or reasoning. Anthropic models and OpenAI models were excluded, preserving the constraints used for the paid Zen shortlist. GPT-OSS was not tested even though it is open weight because its catalog vendor is OpenAI.

| Candidate | Published input / output price per million tokens | Why tested |
| --- | ---: | --- |
| `@cf/ibm-granite/granite-4.0-h-micro` | $0.017 / $0.112 | Cheapest plausible narrow router |
| `@cf/qwen/qwen3-30b-a3b-fp8` | $0.051 / $0.335 | Cheap instruction-following MoE |
| `@cf/google/gemma-4-26b-a4b-it` | $0.100 / $0.300 | Cheap function-calling model |
| `@cf/zai-org/glm-5.3-flash` | $0.150 / $0.500 | Exact-model comparison with the earlier Zen baseline |
| `@cf/nvidia/nemotron-3-120b-a12b` | $0.500 / $1.500 | Agentic/function-calling candidate |
| `@cf/qwen/qwen3.8-27b` | $0.450 / $3.200 | Previously requested Qwen 3.8 family candidate |

Cloudflare's catalog currently advertises all six model IDs. The pricing page says Workers AI includes 10,000 neurons per day, then costs $0.011 per 1,000 neurons on Workers Paid. It also says GLM 5.3 Flash specifically requires Workers Paid or prepaid AI Gateway credits. [Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

## Method

The test used the fixed 14-case corpus from the Zen benchmark without changing the prompt, Flow catalog, expected answers, temperature, or 1,024-token completion ceiling. It covered:

- ordinary Analyze and Implement requests;
- explicit disabling of anonymous web research;
- ambiguity requiring one question;
- unsupported deployment and authenticated-web requests;
- authorized clarification replies;
- artifact references; and
- hostile issue text attempting to override the authorized invocation.

Every candidate received one sequential 14-case screening pass. The two strongest candidates, Nemotron and GLM, then received an identical second pass. Results were atomically persisted after every request. The scorer separately checked JSON shape, cross-field domain postconditions, Flow selection, override selection, and clarification quality.

The calls ran through an ephemeral local Wrangler development Worker with a remote `env.AI` binding. No Worker was deployed. The process was stopped after the run. The benchmark called the native binding directly so it did not modify the repository dependency graph; using the official TanStack adapter remains an implementation-time contract test.

Cloudflare documents JSON Schema output through `response_format`, while warning that schema compliance is not guaranteed and must be handled as an error. That matched the observed truncation and null-output failures. [Workers AI JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)

## Results

| Candidate | Attempts | Schema valid | Full pass | Median | p95 | Maximum | Measured cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `nemotron-3-120b-a12b` | 28 | 28/28 | 28/28 | 3.910 s | 6.769 s | 8.307 s | $0.018856 |
| `glm-5.3-flash` | 28 | 27/28 | 27/28 | 7.757 s | 30.077 s | 38.090 s | $0.005571 |
| `qwen3-30b-a3b-fp8` | 14 | 13/14 | 12/14 | 2.835 s | 9.239 s | 9.239 s | $0.002069 |
| `qwen3.8-27b` | 14 | 12/14 | 12/14 | 11.768 s | 46.310 s | 46.310 s | $0.026570 |
| `gemma-4-26b-a4b-it` | 14 | 12/14 | 10/14 | 6.534 s | 15.455 s | 15.455 s | $0.002285 |
| `granite-4.0-h-micro` | 14 | 14/14 | 2/14 | 2.291 s | 3.541 s | 3.541 s | $0.000165 |

The published token prices applied to returned usage total $0.055516 for the recorded corpus. The calls reported 5,033.16 neurons, equivalent to $0.055365 before any daily free allocation. One preliminary successful GLM smoke added 16.31 neurons, or about $0.000179 at the neuron rate. A failed Free-plan availability check reported no usage. The complete investigation therefore remained far below the existing $1 benchmark cap and within one 10,000-neuron daily allocation if the account had no other Workers AI use that day.

### Failure analysis

- **Nemotron:** no failures in 28 attempts.
- **GLM 5.3 Flash:** the second hostile Implement case returned incomplete JSON once after using the full completion allowance; the identical repeat passed. This supports the same one-retry policy proposed for Zen but is worse evidence than a clean 28/28.
- **Qwen3 30B:** selected Analyze instead of asking about unavailable authenticated web access, then returned `null` for the unresolved clarification-reply case.
- **Qwen3.8 27B:** returned `null` for both unsupported-capability cases. It was also the slowest and most expensive tested Workers AI candidate because of high completion usage.
- **Gemma 4:** produced two truncated JSON responses and two clarification objects that incorrectly retained a `flowId`.
- **Granite Micro:** produced JSON consistently but over-clarified most authorized requests and often populated contradictory fields. Its low price does not compensate for 2/14 correctness.

No candidate followed the hostile issue text into an unsafe route. The meaningful safety miss was Qwen3 30B accepting an authenticated-web analysis request even though that capability was absent from the supplied Flow catalog.

## Pricing comparison with Zen

Price depends on the model; neither provider is uniformly cheaper:

- GLM 5.3 Flash has the same published $0.15 input / $0.50 output rate on both providers.
- Workers AI Qwen3 30B is exceptionally cheap at $0.051 / $0.335, but its 12/14 result is not sufficient.
- Zen DeepSeek V4 Flash is $0.14 / $0.28, while Cloudflare lists its DeepSeek V4 Flash at $0.44 / $1.32, so Zen is substantially cheaper for that exact family.
- The selected Zen Gemini Lite costs $0.30 / $2.50. Its concise outputs still made the measured route cheaper than perfect Workers AI Nemotron and slightly cheaper than Cloudflare GLM.

The measured route cost matters more than headline token price for reasoning models. Qwen3.8 demonstrates this: its published rate looked acceptable, but its completion usage made one screening pass cost $0.026570, more than the two complete Nemotron passes.

## TanStack AI integration

Workers AI is the easier integration inside the Cloudflare control plane.

Cloudflare publishes `@cloudflare/tanstack-ai` and recommends creating a Workers AI adapter from the native binding:

```ts
const adapter = createWorkersAiChat(
  "@cf/nvidia/nemotron-3-120b-a12b",
  { binding: env.AI },
)
```

This needs one `ai` binding in Wrangler configuration and no model-provider API secret. The same adapter exposes chat and structured output, and its model string can select any Workers AI model behind that binding. The package also supports REST, AI Gateway binding, and AI Gateway REST modes. Cloudflare currently publishes version `0.2.1`, so pin it and verify the routing schema before relying on it. [Cloudflare TanStack AI adapter](https://github.com/cloudflare/ai/tree/main/packages/tanstack-ai), [package metadata](https://github.com/cloudflare/ai/blob/main/packages/tanstack-ai/package.json), [Workers AI bindings](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/)

Zen Gemini Lite needs an external secret plus the Gemini-specific TanStack adapter and a corrected Google endpoint configuration. That is still a modest integration, but it has more moving parts than `env.AI`: secret lifecycle, external provider availability, the Zen gateway, and the Google SDK's URL behavior.

The tradeoff is portability. Zen remains an ordinary external HTTP provider. A Workers AI binding couples this adapter to Cloudflare, although Workers AI also exposes an OpenAI-compatible REST endpoint and Ornn's internal router interface can keep the coupling at one module boundary. [Workers AI OpenAI-compatible endpoints](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)

## Rerun rule

Rerun both provider finalists when any of these change:

1. model ID or provider;
2. system prompt, schema, Flow catalog, or postconditions;
3. TanStack or Cloudflare adapter version;
4. maximum completion tokens or reasoning controls; or
5. published price or provider availability.

For a future Workers AI rerun, test `reasoning_effort: "low"` and `chat_template_kwargs: { enable_thinking: false }` where the selected model explicitly supports them. Cloudflare's adapter exposes those controls, and reducing unnecessary thought tokens may materially improve GLM or Qwen latency and cost. Do not assume support across models without a contract test.
