# Ornn Forge

Ornn Forge receives bounded work from GitHub and returns inspectable results produced in isolated execution environments.

## Language

**Invocation**:
An explicit, authorized request for Ornn Forge to act on a GitHub issue or pull request.
_Avoid_: Trigger, command

**Work order**:
The bounded instructions and repository context supplied by an invocation.
_Avoid_: Task, request, prompt

**Job**:
One durable attempt to execute a work order by composing capabilities and reporting their outcome.
_Avoid_: Run, workflow

**Artifact**:
An inspectable result returned by a job, such as an analysis comment, patch, log bundle, branch, or draft pull request.
_Avoid_: Output, response

**Capability**:
One independently testable and observable operation that a job can compose with other capabilities.
_Avoid_: Primitive, service, workflow step

**Agent engine**:
A replaceable component that executes a work order through a coding agent. An agent engine is separate from the model provider and the sandbox runner.
_Avoid_: Model, sandbox runner, orchestrator

**Sandbox runner**:
A replaceable source of isolated execution capacity that conforms to Ornn Forge's sandbox contract. A sandbox runner may use a third-party system such as Daytona or software installed on a user-owned machine.
_Avoid_: Sandbox provider, worker, edge server
