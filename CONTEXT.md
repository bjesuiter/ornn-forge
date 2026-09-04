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
A replaceable component that executes a work order through a coding agent. An agent engine is separate from the model provider, Runner, and sandbox driver.
_Avoid_: Model, Runner, orchestrator

**Runner**:
A component that executes a job by combining an agent engine with a sandbox driver. A Runner may be embedded in the control plane or deployed remotely.
_Avoid_: Sandbox runner, worker, executor

**Embedded Runner**:
A Runner that operates inside the control plane and receives assigned jobs directly.
_Avoid_: Control-plane worker, local Runner

**Remote Runner**:
An independently deployed Runner that receives job leases from the control plane.
_Avoid_: Runner daemon, worker, agent

**Runner capacity**:
The maximum number of jobs a Runner may execute concurrently.
_Avoid_: Worker count, parallelism

**Sandbox driver**:
A replaceable component through which a Runner creates and controls isolated execution environments.
_Avoid_: Sandbox provider, sandbox runner

**Sandbox**:
An isolated execution environment assigned to a job.
_Avoid_: Runner, container
