# Keep the sandbox driver generic

Ornn's sandbox-driver interface will cover sandbox creation and inspection, process execution and process-tree termination, file import and export, and verified destruction. It will not expose Git, GitHub, Pi, agent-engine, TanStack, Docker, or Daytona concepts. This surface is larger than a minimal `execute` and `close` pair because Ornn needs portable recovery, cancellation, artifact transfer, resource validation, and independently verified cleanup, but it avoids turning the driver into a repository workflow abstraction.

The stable v1 error codes are `rejected`, `not_found`, `conflict`, `resource_exhausted`, `unavailable`, `deadline_exceeded`, and `internal`. Every error also reports whether the attempted operation definitely had no effect or may have had an effect. Callers inspect or discover before retrying an uncertain mutation.

## Consequences

Provider adapters must translate their native handles, lifecycle states, process controls, file APIs, and failures into Ornn-owned types and errors. Repository checkout, work-order execution, artifact construction, and publication remain Runner or control-plane responsibilities above the driver.

The first Docker adapter must own deterministic container identity, Ornn labels, resource policy, discovery, whole-container termination, and verified removal. The current TanStack Docker provider remains useful for filesystem and process operations, but its destroy path suppresses failures and its creation contract lacks the identity and resource controls Ornn needs. Ornn must wrap direct Docker operations or provide its own TanStack-compatible provider. See [the failure and cleanup contract](../research/analyze-flow-sandbox-failure-and-cleanup.md).
