# Track execution and cleanup independently

Each job will record an execution outcome separately from its cleanup status. A job may report successful execution and preserve or publish its artifact while sandbox teardown remains pending or has failed, provided the result carries a visible cleanup warning and the reaper continues cleanup attempts. This preserves useful work without hiding leaked-resource risk behind an ordinary success state.

## Consequences

Job APIs, durable events, GitHub reporting, telemetry, and operator inspection must expose both dimensions. `succeeded` describes execution only and never proves that the sandbox was removed. The job retains its Runner capacity reservation until cleanup is verified; pending or failed cleanup may therefore exhaust capacity and stop the Runner from leasing more jobs while the reaper retries.
