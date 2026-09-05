# Keep the sandbox driver generic

Ornn's sandbox-driver interface will cover sandbox creation and inspection, process execution and process-tree termination, file import and export, and verified destruction. It will not expose Git, GitHub, Pi, agent-engine, TanStack, Docker, or Daytona concepts. This surface is larger than a minimal `execute` and `close` pair because Ornn needs portable recovery, cancellation, artifact transfer, resource validation, and independently verified cleanup, but it avoids turning the driver into a repository workflow abstraction.

## Consequences

Provider adapters must translate their native handles, lifecycle states, process controls, file APIs, and failures into Ornn-owned types and errors. Repository checkout, work-order execution, artifact construction, and publication remain Runner or control-plane responsibilities above the driver.
