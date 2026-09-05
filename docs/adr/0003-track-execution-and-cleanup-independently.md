# Track execution and cleanup independently

Each job will record an execution outcome separately from its cleanup status. A job may report successful execution and preserve or publish its artifact while sandbox teardown remains pending or has failed, provided the result carries a visible cleanup warning and the reaper continues cleanup attempts. This preserves useful work without hiding leaked-resource risk behind an ordinary success state.

For the first Docker Runner, cancellation stops the whole Job container and escalates from a five-second graceful stop to forced removal. Cleanup becomes verified only after Docker is reachable and the adapter proves that the exact owned container and its recorded anonymous volumes are absent. A successful remove request, closed client stream, or missing in-memory handle is not proof.

## Consequences

Job APIs, durable events, GitHub reporting, telemetry, and operator inspection must expose both dimensions. `succeeded` describes execution only and never proves that the sandbox was removed. The job retains its Runner capacity reservation until cleanup is verified; pending or failed cleanup may therefore exhaust capacity and stop the Runner from leasing more jobs while the reaper retries.

Inline cleanup has a 60-second budget. After that, Ornn marks cleanup failed, quarantines the sandbox, and retries after about 30 seconds, one minute, two minutes, four minutes, eight minutes, and then every 15 minutes with jitter. A retry count never turns an unverified resource into a verified deletion. See [the failure and cleanup contract](../research/analyze-flow-sandbox-failure-and-cleanup.md).
