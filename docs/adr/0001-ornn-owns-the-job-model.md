# Ornn owns the job model

Ornn Forge will own the invocation, work order, job state, capability composition, durable events, sandbox-runner protocol, artifact publication, authorization, and policy. Focused third-party components may implement mechanics behind Ornn-owned contracts, but their types, identifiers, state models, and workflow rules must not enter the domain model. This preserves control and replaceability without rebuilding generic infrastructure.

## Considered options

- Adopting a complete agent or workflow product would accelerate some early behavior but give another system ownership of Ornn's job semantics and durable state.
- Implementing every mechanism directly would maximize control but spend time rebuilding agent loops, sandbox operations, database access, object storage clients, telemetry protocols, cryptography, and GitHub clients.
- The selected middle path keeps Ornn's behavior in its own small capabilities while delegating bounded mechanics to replaceable libraries.

## Consequences

Permanent dependencies must fit behind one adapter module, be pinned to exact versions, and pass Ornn-owned contract tests. Provider-native identifiers remain diagnostic metadata. A fake or second adapter must be able to pass the same contract before a boundary is considered proven replaceable.
