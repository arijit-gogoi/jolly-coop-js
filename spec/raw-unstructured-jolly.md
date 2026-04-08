

---
Below is a concise, formal specification for Jolly v1. It defines the API surface, behavioral semantics, guarantees, and error model so that other developers can rely on the runtime contract.

Jolly v1 Specification
1. Scope

Jolly is a structured concurrency runtime for JavaScript providing deterministic task lifetimes, cancellation propagation, and scoped resource management.

This specification defines:

public API
execution semantics
runtime guarantees
task lifecycle
error and cancellation behavior

This spec targets single-process runtimes including:

Node.js
Bun
Deno
Browsers
2. Terminology
Scope

A scope is a structured concurrency boundary that owns:

tasks
child scopes
resources

A scope represents a lifetime region.

Task

A task is a unit of asynchronous work created by spawn.

Tasks belong to exactly one scope.

Resource

A resource is an object with a disposer registered with a scope.

Resources are cleaned when the scope exits.

Cancellation

Cancellation is a signal propagated through the scope tree that requests tasks to terminate early.

3. Public API

Jolly v1 exposes the following API.

3.1 Functions
scope(options?, fn)
sleep(ms)
yieldNow()
3.2 Scope Interface
interface Scope {

  spawn<T>(fn: () => Promise<T> | T): Task<T>

  resource<T>(
    value: Promise<T> | T,
    disposer: (value: T) => Promise<void> | void
  ): Promise<T>

  cancel(reason?: any): void

  readonly signal: AbortSignal

}
3.3 Task Interface
interface Task<T> extends PromiseLike<T> {

  readonly id: number

  readonly state:
    | "running"
    | "completed"
    | "failed"
    | "cancelled"

}

Tasks behave as promises and may be awaited.

3.4 Scope Options
interface ScopeOptions {

  timeout?: number

  deadline?: number

  limit?: number

  signal?: AbortSignal

}
4. Execution Semantics
4.1 Scope Execution

scope(fn) executes fn with a new scope.

Execution order:

create scope
run fn(scope)
wait for child tasks
cleanup resources
resolve or reject

The scope resolves when:

all child tasks complete
4.2 Spawn Semantics
s.spawn(fn)

Behavior:

task created
task attached to scope
task scheduled

Tasks begin execution under scheduler control.

spawn must not accept promises.

4.3 Awaiting Tasks

Tasks can be awaited like promises.

Example:

const t = s.spawn(fetchUser)

await t

Awaiting a task resolves with the task result.

5. Cancellation Semantics
5.1 Scope Cancellation

Calling:

scope.cancel()

causes:

scope marked cancelled
abort signal triggered
child tasks observe cancellation

Cancellation propagates to:

child tasks
child scopes
5.2 Cancellation Behavior

A task may observe cancellation via:

AbortSignal
runtime checks

Cancellation does not forcibly interrupt execution.

Tasks cooperate with cancellation.

6. Error Semantics
6.1 First Error Rule

If a task throws an error:

first error becomes scope error
scope cancels remaining tasks

The scope rejects with the first error.

6.2 Secondary Errors

Errors from cancelled tasks are:

captured internally
not thrown by the scope

This prevents nondeterministic error aggregation.

7. Concurrency Limits

Scopes may specify:

scope({ limit: n })

Behavior:

no more than n tasks run concurrently
excess tasks queued
queued tasks start when running tasks complete

Limit enforcement is deterministic.

8. Resource Semantics

Resources registered with:

s.resource(value, disposer)

are owned by the scope.

Cleanup occurs when the scope exits.

Cleanup order:

reverse registration order

Example:

resource A
resource B
cleanup → B then A
9. Timeout and Deadline Semantics

Scopes may specify:

timeout
deadline

When exceeded:

scope cancels
tasks cancelled
scope rejects with TimeoutError

Timeout is relative.

Deadline is absolute time.

10. Scheduler Semantics

The runtime scheduler guarantees:

tasks execute only through scheduler
tasks may yield cooperatively
execution order may vary

The scheduler does not guarantee fairness across scopes.

11. Task State Machine

Tasks follow this lifecycle.

States:

CREATED
RUNNING
COMPLETED
FAILED
CANCELLED

Transitions:

CREATED → RUNNING
CREATED → CANCELLED
RUNNING → COMPLETED
RUNNING → FAILED
RUNNING → CANCELLED

Terminal states:

COMPLETED
FAILED
CANCELLED

Tasks cannot transition out of terminal states.

12. Runtime Guarantees

Jolly v1 guarantees the following invariants.

tasks belong to exactly one scope
resources belong to scopes
scopes wait for tasks before exiting
scopes clean resources on exit
scheduler controls task execution
cancellation propagates downward
concurrency limits are enforced
scope fails on first error
tasks cannot outlive their scope
task completion occurs exactly once
spawned tasks begin execution through scheduler

Violation of these guarantees indicates a runtime bug.

13. Determinism

Jolly provides deterministic behavior for:

task lifetime
scope completion
resource cleanup
cancellation propagation

Scheduling order is not deterministic.

14. Compatibility

Jolly integrates with existing async APIs through:

Promise compatibility
AbortSignal propagation
async/await support

Tasks may await any standard promise.

15. Implementation Freedom

Runtime implementations may vary internally.

Implementations may:

change scheduler strategy
optimize task queues
use workers

As long as the behavioral guarantees in this specification remain true.

16. Versioning

This specification defines Jolly v1 semantics.

Future versions may extend the API but must not break:

scope semantics
task lifecycle
cancellation guarantees
17. Compliance

An implementation is Jolly v1 compliant if:

all API contracts are respected
all runtime guarantees hold
all lifecycle semantics are preserved
Summary

The Jolly v1 specification formally defines:

API surface
task lifecycle
scope semantics
cancellation rules
error propagation
resource cleanup
concurrency limits
runtime invariants

This document forms the contract between the runtime and its users.Below is a concise, formal specification for Jolly v1. It defines the API surface, behavioral semantics, guarantees, and error model so that other developers can rely on the runtime contract.

Jolly v1 Specification
1. Scope

Jolly is a structured concurrency runtime for JavaScript providing deterministic task lifetimes, cancellation propagation, and scoped resource management.

This specification defines:

public API
execution semantics
runtime guarantees
task lifecycle
error and cancellation behavior

This spec targets single-process runtimes including:

Node.js
Bun
Deno
Browsers
2. Terminology
Scope

A scope is a structured concurrency boundary that owns:

tasks
child scopes
resources

A scope represents a lifetime region.

Task

A task is a unit of asynchronous work created by spawn.

Tasks belong to exactly one scope.

Resource

A resource is an object with a disposer registered with a scope.

Resources are cleaned when the scope exits.

Cancellation

Cancellation is a signal propagated through the scope tree that requests tasks to terminate early.

3. Public API

Jolly v1 exposes the following API.

3.1 Functions
scope(options?, fn)
sleep(ms)
yieldNow()
3.2 Scope Interface
interface Scope {

  spawn<T>(fn: () => Promise<T> | T): Task<T>

  resource<T>(
    value: Promise<T> | T,
    disposer: (value: T) => Promise<void> | void
  ): Promise<T>

  cancel(reason?: any): void

  readonly signal: AbortSignal

}
3.3 Task Interface
interface Task<T> extends PromiseLike<T> {

  readonly id: number

  readonly state:
    | "running"
    | "completed"
    | "failed"
    | "cancelled"

}

Tasks behave as promises and may be awaited.

3.4 Scope Options
interface ScopeOptions {

  timeout?: number

  deadline?: number

  limit?: number

  signal?: AbortSignal

}
4. Execution Semantics
4.1 Scope Execution

scope(fn) executes fn with a new scope.

Execution order:

create scope
run fn(scope)
wait for child tasks
cleanup resources
resolve or reject

The scope resolves when:

all child tasks complete
4.2 Spawn Semantics
s.spawn(fn)

Behavior:

task created
task attached to scope
task scheduled

Tasks begin execution under scheduler control.

spawn must not accept promises.

4.3 Awaiting Tasks

Tasks can be awaited like promises.

Example:

const t = s.spawn(fetchUser)

await t

Awaiting a task resolves with the task result.

5. Cancellation Semantics
5.1 Scope Cancellation

Calling:

scope.cancel()

causes:

scope marked cancelled
abort signal triggered
child tasks observe cancellation

Cancellation propagates to:

child tasks
child scopes
5.2 Cancellation Behavior

A task may observe cancellation via:

AbortSignal
runtime checks

Cancellation does not forcibly interrupt execution.

Tasks cooperate with cancellation.

6. Error Semantics
6.1 First Error Rule

If a task throws an error:

first error becomes scope error
scope cancels remaining tasks

The scope rejects with the first error.

6.2 Secondary Errors

Errors from cancelled tasks are:

captured internally
not thrown by the scope

This prevents nondeterministic error aggregation.

7. Concurrency Limits

Scopes may specify:

scope({ limit: n })

Behavior:

no more than n tasks run concurrently
excess tasks queued
queued tasks start when running tasks complete

Limit enforcement is deterministic.

8. Resource Semantics

Resources registered with:

s.resource(value, disposer)

are owned by the scope.

Cleanup occurs when the scope exits.

Cleanup order:

reverse registration order

Example:

resource A
resource B
cleanup → B then A
9. Timeout and Deadline Semantics

Scopes may specify:

timeout
deadline

When exceeded:

scope cancels
tasks cancelled
scope rejects with TimeoutError

Timeout is relative.

Deadline is absolute time.

10. Scheduler Semantics

The runtime scheduler guarantees:

tasks execute only through scheduler
tasks may yield cooperatively
execution order may vary

The scheduler does not guarantee fairness across scopes.

11. Task State Machine

Tasks follow this lifecycle.

States:

CREATED
RUNNING
COMPLETED
FAILED
CANCELLED

Transitions:

CREATED → RUNNING
CREATED → CANCELLED
RUNNING → COMPLETED
RUNNING → FAILED
RUNNING → CANCELLED

Terminal states:

COMPLETED
FAILED
CANCELLED

Tasks cannot transition out of terminal states.

12. Runtime Guarantees

Jolly v1 guarantees the following invariants.

tasks belong to exactly one scope
resources belong to scopes
scopes wait for tasks before exiting
scopes clean resources on exit
scheduler controls task execution
cancellation propagates downward
concurrency limits are enforced
scope fails on first error
tasks cannot outlive their scope
task completion occurs exactly once
spawned tasks begin execution through scheduler

Violation of these guarantees indicates a runtime bug.

13. Determinism

Jolly provides deterministic behavior for:

task lifetime
scope completion
resource cleanup
cancellation propagation

Scheduling order is not deterministic.

14. Compatibility

Jolly integrates with existing async APIs through:

Promise compatibility
AbortSignal propagation
async/await support

Tasks may await any standard promise.

15. Implementation Freedom

Runtime implementations may vary internally.

Implementations may:

change scheduler strategy
optimize task queues
use workers

As long as the behavioral guarantees in this specification remain true.

16. Versioning

This specification defines Jolly v1 semantics.

Future versions may extend the API but must not break:

scope semantics
task lifecycle
cancellation guarantees
17. Compliance

An implementation is Jolly v1 compliant if:

all API contracts are respected
all runtime guarantees hold
all lifecycle semantics are preserved
Summary

The Jolly v1 specification formally defines:

API surface
task lifecycle
scope semantics
cancellation rules
error propagation
resource cleanup
concurrency limits
runtime invariants

This document forms the contract between the runtime and its users.
---
---
Below is the **complete guarantee set for Jolly v1**, and which subsystem enforces each.

---

# 1. Complete Runtime Guarantees for Jolly v1

A correct v1 runtime should enforce these guarantees:

1. Tasks belong to scopes  
2. Resources belong to scopes  
3. Scopes wait for tasks before exiting  
4. Scopes clean resources on exit  
5. Scheduler controls task execution  
6. Cancellation propagates downward  
7. Concurrency limits are enforced  
8. Scope fails on first error  
9. Tasks cannot outlive their scope  
10. Task completion happens exactly once  
11. Spawned tasks begin execution under scheduler control

Your list already contains **7 of these**.

The missing ones are **crucial correctness guarantees**.

---

# 2. Guarantee → Enforcing Subsystem

Each guarantee must be enforced by a specific subsystem in the runtime architecture.

|Guarantee|Enforced By|
|---|---|
|tasks belong to scopes|**Task system + Scope system**|
|resources belong to scopes|**Resource subsystem**|
|scopes wait for tasks|**Scope lifecycle manager**|
|scopes clean resources|**Resource manager**|
|scheduler controls execution|**Scheduler subsystem**|
|cancellation propagates downward|**Scope cancellation logic**|
|limits enforce concurrency|**Scope limits subsystem**|
|scope fails on first error|**Task error handling + scope cancellation**|
|tasks cannot outlive scope|**Scope lifecycle manager**|
|task completion happens once|**Task lifecycle logic**|
|spawned tasks begin under scheduler|**spawn() implementation**|

Each guarantee is enforced by **exactly one subsystem**, which keeps the architecture clean.

---

# 3. Detailed Breakdown

## 1. Tasks belong to scopes

Guarantee:

every task has exactly one parent scope

Enforced by:

task/spawn.ts  
scope.ts

Mechanism:

spawn(fn)  
↓  
create Task  
↓  
task.scope = currentScope  
↓  
scope.activeTasks++

Violation would cause **orphan tasks**, which structured concurrency forbids.

---

## 2. Resources belong to scopes

Guarantee:

resources are tied to scope lifetime

Enforced by:

resources/resource.ts

Mechanism:

s.resource(value, disposer)  
↓  
scope.resources.push(disposer)

Cleanup happens on scope exit.

---

## 3. Scopes wait for tasks

Guarantee:

scope resolves only when activeTasks == 0

Enforced by:

scope-run.ts

Mechanism:

while (scope.active > 0)  
  await scheduler.yield()

---

## 4. Scopes clean resources

Guarantee:

resources disposed after tasks finish

Enforced by:

resources/resource.ts  
scope-run.ts

Mechanism:

scope exit  
↓  
run disposers in reverse order

---

## 5. Scheduler controls execution

Guarantee:

tasks execute only through scheduler

Enforced by:

scheduler/scheduler.ts  
spawn.ts

Mechanism:

spawn(fn)  
↓  
scheduler.enqueue(task)

Tasks never execute synchronously.

---

## 6. Cancellation propagates downward

Guarantee:

parent scope cancellation cancels children

Enforced by:

scope/cancellation.ts

Mechanism:

scope.cancel()  
↓  
AbortController.abort()  
↓  
child tasks observe signal

---

## 7. Concurrency limits enforced

Guarantee:

runningTasks ≤ limit

Enforced by:

scope/limits.ts

Mechanism:

spawn  
↓  
if running < limit 
  run task  
else  
  queue task

---

## 8. Scope fails on first error

Guarantee:

first task error determines scope failure

Enforced by:

task execution wrapper  
scope cancellation logic

Mechanism:

task throws  
↓  
if no primaryError  
  primaryError = err  
  scope.cancel()

---

## 9. Tasks cannot outlive their scope

Guarantee:

all tasks finish or cancel before scope exits

Enforced by:

scope lifecycle

Mechanism:

scope waits for activeTasks

If violated, tasks could leak.

---

## 10. Task completion happens exactly once

Guarantee:

task resolves or rejects once

Enforced by:

task/task.ts

Mechanism:

task.state transitions  
running → completed  
running → failed  
running → cancelled

State machine prevents double completion.

---

## 11. Spawned tasks begin under scheduler

Guarantee:

task execution always begins through scheduler

Enforced by:

spawn.ts

Mechanism:

scheduler.enqueue(task)

This prevents tasks bypassing scheduling.

---

# 4. Guarantee Map to Subsystems

You can view the runtime as enforcing guarantees per subsystem.

Scope System  
 ├ tasks belong to scopes  
 ├ scopes wait for tasks  
 ├ tasks cannot outlive scopes  
 └ cancellation propagation  
  
Task System  
 ├ task completion exactly once  
 └ spawn semantics  
  
Scheduler  
 ├ scheduler controls execution  
 └ cooperative fairness  
  
Limits  
 └ concurrency enforcement  
  
Resources  
 └ resource cleanup

This separation is intentional.

---

# 5. Guarantees That v1 Does NOT Provide

Some guarantees are intentionally excluded from v1:

parallel CPU scheduling  
distributed execution  
priority scheduling  
fairness guarantees across scopes

These would require a more complex runtime.

---

# 6. Final Guarantee Set

For v1, the runtime guarantees are:

tasks belong to scopes  
resources belong to scopes  
scopes wait for tasks  
scopes clean resources  
scheduler controls execution  
cancellation propagates downward  
limits enforce concurrency  
scope fails on first error  
tasks cannot outlive their scope  
task completion happens exactly once  
spawned tasks start under scheduler control

This is the **minimal correctness contract** for a structured concurrency runtime.

---

If you'd like, the next thing worth doing is defining the **formal task state machine**, because that is the piece that prevents subtle lifecycle bugs in runtimes like this
---
---
TASK STATE MACHINE
A formal **task state machine** defines the legal lifecycle of a task and prevents subtle runtime bugs such as:

double completion  
orphan tasks  
execution after cancellation  
incorrect error propagation

For Jolly v1 the task lifecycle can be expressed with **five states and a small number of valid transitions**.

---

# 1. Task State Set

The runtime should define exactly these states:

CREATED  
RUNNING  
COMPLETED  
FAILED  
CANCELLED

Terminal states:

COMPLETED  
FAILED  
CANCELLED

Once a task reaches a terminal state, it must **never transition again**.

---

# 2. State Definitions

## CREATED

Task object exists but execution has not begun.

Created during:

spawn(fn)

Properties:

task.scope assigned  
task.promise created  
task not yet executed

---

## RUNNING

The scheduler has started executing the task.

Meaning:

fn() executing  
task may suspend via await  
task may complete or fail

The task remains RUNNING until termination.

---

## COMPLETED

The task finished successfully.

Meaning:

resolve(value)

Scope bookkeeping:

scope.activeTasks--

The result is available to `await`.

---

## FAILED

The task threw an error.

Meaning:

reject(error)

Runtime behavior:

scope.primaryError set  
scope.cancel()

Sibling tasks are cancelled.

---

## CANCELLED

Task was cancelled before completion.

Meaning:

scope cancelled  
AbortSignal triggered  
task stops execution

Tasks may enter this state:

before execution  
during execution  
while suspended

---

# 3. Valid State Transitions

The legal transitions are:

CREATED   → RUNNING  
RUNNING   → COMPLETED  
RUNNING   → FAILED  
RUNNING   → CANCELLED  
CREATED   → CANCELLED

No other transitions are allowed.

---

# 4. State Transition Diagram

The complete state machine:

        spawn()  
           │  
           ▼  
        CREATED  
           │  
           ▼  
        RUNNING  
        │   │   │  
        │   │   │  
        ▼   ▼   ▼  
   COMPLETED FAILED CANCELLED

Additional transition:

CREATED → CANCELLED

This happens if the scope cancels **before the scheduler executes the task**.

---

# 5. Illegal Transitions

The runtime must prevent these transitions.

COMPLETED → FAILED  
FAILED → COMPLETED  
CANCELLED → RUNNING  
RUNNING → CREATED

These indicate a runtime bug.

---

# 6. Formal State Table

|From|To|Cause|
|---|---|---|
|CREATED|RUNNING|scheduler starts task|
|CREATED|CANCELLED|scope cancelled early|
|RUNNING|COMPLETED|function resolves|
|RUNNING|FAILED|function throws|
|RUNNING|CANCELLED|scope cancelled|

Terminal states cannot transition.

---

# 7. Transition Enforcement

Each transition must be enforced by specific runtime subsystems.

|Transition|Enforced By|
|---|---|
|CREATED → RUNNING|scheduler|
|RUNNING → COMPLETED|task wrapper|
|RUNNING → FAILED|task wrapper|
|RUNNING → CANCELLED|cancellation system|
|CREATED → CANCELLED|spawn + cancellation|

---

# 8. Example Runtime Implementation

Minimal state enforcement:

enum TaskState {  
  CREATED,  
  RUNNING,  
  COMPLETED,  
  FAILED,  
  CANCELLED  
}

State transition guard:

function transition(task, next) {  
  
  const current = task.state  
  
  const valid =  
    (current === CREATED && next === RUNNING) ||  
    (current === CREATED && next === CANCELLED) ||  
    (current === RUNNING && next === COMPLETED) ||  
    (current === RUNNING && next === FAILED) ||  
    (current === RUNNING && next === CANCELLED)  
  
  if (!valid) {  
    throw new Error("illegal task transition")  
  }  
  
  task.state = next  
}

This ensures runtime correctness.

---

# 9. Interaction With Scope Cancellation

Example scenario:

scope.cancel()

Tasks transition as follows.

If running:

RUNNING → CANCELLED

If queued:

CREATED → CANCELLED

This prevents execution after cancellation.

---

# 10. Interaction With Errors

When a task fails:

RUNNING → FAILED

Runtime action:

scope.primaryError = error  
scope.cancel()

Sibling tasks then transition:

RUNNING → CANCELLED

---

# 11. Scheduler Interaction

Scheduler only performs:

CREATED → RUNNING

It must **never run tasks already cancelled**.

Guard:

if task.state !== CREATED  
  do not execute

---

# 12. Task Lifecycle Example

Example program:

await scope(async s => {  
  
  const t = s.spawn(async () => {  
    await sleep(10)  
    return 42  
  })  
  
  await t  
  
})

Lifecycle:

spawn  
CREATED  
scheduler runs  
RUNNING  
await sleep  
RUNNING  
function returns  
COMPLETED

---

# 13. Cancellation Example

Example:

await scope(async s => {  
  
  s.spawn(async () => {  
    await sleep(100)  
  })  
  
  s.cancel()  
  
})

Lifecycle:

CREATED  
CANCELLED

Task never executes.

---

# 14. Runtime Guarantee Enforced by State Machine

The state machine enforces several runtime guarantees automatically:

task completion happens once  
tasks cannot restart  
cancelled tasks never execute

Without this model, async runtimes easily develop race bugs.

---

# 15. Final Task State Machine

The formal model for Jolly v1 is:

States:  
  CREATED  
  RUNNING  
  COMPLETED  
  FAILED  
  CANCELLED  
  
Terminal:  
  COMPLETED  
  FAILED  
  CANCELLED  
  
Transitions:  
  CREATED → RUNNING  
  CREATED → CANCELLED  
  RUNNING → COMPLETED  
  RUNNING → FAILED  
  RUNNING → CANCELLED

This small state machine is **the core correctness model for the runtime**

---
---
TESTS

A production-ready runtime like Jolly should have a **comprehensive, layered test suite**. Concurrency runtimes fail in subtle ways, so the tests must verify:

- API behavior
- runtime guarantees
- task lifecycle
- cancellation semantics
- resource safety
- scheduling correctness
- race conditions

A strong v1 test suite should contain **~120–180 tests** organized by subsystem.

Below is the **complete testing architecture for Jolly v1**.

---

# 1. Test Suite Structure

Directory layout:

tests/  
  scope/  
  tasks/  
  cancellation/  
  limits/  
  resources/  
  timeouts/  
  scheduler/  
  lifecycle/  
  nested/  
  stress/

Each directory verifies one subsystem.

---

# 2. Scope Behavior Tests

Verify structured concurrency semantics.

### Scope waits for tasks

Writing

test("scope waits for child tasks", async () => {

let done = false

await scope(async s => {

```
s.spawn(async () => {
  await sleep(10)
  done = true
})
```

})

expect(done).toBe(true)

})

---

### Scope returns value

Writing

test("scope returns result", async () => {

const result = await scope(async s => {  
return 42  
})

expect(result).toBe(42)

})

---

### Scope handles many tasks

Writing

test("scope handles many tasks", async () => {

let count = 0

await scope(async s => {

```
for (let i = 0; i < 50; i++) {
  s.spawn(() => count++)
}
```

})

expect(count).toBe(50)

})

---

# 3. Task Lifecycle Tests

Verify the task state machine.

### Task completes

Writing

test("task resolves", async () => {

await scope(async s => {

```
const t = s.spawn(async () => 5)

const value = await t

expect(value).toBe(5)
```

})

})

---

### Task fails

Writing

test("task failure propagates", async () => {

await expect(  
scope(async s => {

```
  s.spawn(async () => {
    throw new Error("fail")
  })

})
```

).rejects.toThrow("fail")

})

---

### Task completes once

Writing

test("task completes exactly once", async () => {

let runs = 0

await scope(async s => {

```
const t = s.spawn(async () => {
  runs++
})

await t
```

})

expect(runs).toBe(1)

})

---

# 4. Cancellation Tests

These are critical.

### Scope cancel stops tasks

Writing

test("scope cancel stops tasks", async () => {

let ran = false

await expect(  
scope(async s => {

```
  s.spawn(async () => {
    await sleep(50)
    ran = true
  })

  s.cancel()

})
```

).rejects.toBeDefined()

expect(ran).toBe(false)

})

---

### Cancel is idempotent

Writing

test("cancel idempotent", async () => {

await scope(async s => {

```
s.cancel()
s.cancel()
s.cancel()
```

})

})

---

### Cancel propagates to children

Writing

test("cancellation propagates downward", async () => {

let ran = false

await expect(  
scope(async s => {

```
  s.spawn(async () => {
    await sleep(50)
    ran = true
  })

  s.cancel()

})
```

).rejects.toBeDefined()

expect(ran).toBe(false)

})

---

# 5. Concurrency Limit Tests

### Limit respected

Writing

test("limit enforces concurrency", async () => {

let running = 0  
let max = 0

await scope({ limit: 2 }, async s => {

```
for (let i = 0; i < 5; i++) {

  s.spawn(async () => {

    running++
    max = Math.max(max, running)

    await sleep(10)

    running--

  })

}
```

})

expect(max).toBeLessThanOrEqual(2)

})

---

### Queued tasks eventually run

Writing

test("queued tasks execute", async () => {

let count = 0

await scope({ limit: 1 }, async s => {

```
for (let i = 0; i < 3; i++) {
  s.spawn(async () => {
    await sleep(10)
    count++
  })
}
```

})

expect(count).toBe(3)

})

---

# 6. Resource Safety Tests

### Resource disposed

Writing

test("resources disposed on scope exit", async () => {

let disposed = false

await scope(async s => {

```
await s.resource({}, () => {
  disposed = true
})
```

})

expect(disposed).toBe(true)

})

---

### Cleanup order

Writing

test("resources disposed reverse order", async () => {

const order: number[] = []

await scope(async s => {

```
await s.resource({}, () => order.push(1))
await s.resource({}, () => order.push(2))
```

})

expect(order).toEqual([2,1])

})

---

# 7. Timeout & Deadline Tests

### Timeout cancels scope

Writing

test("timeout cancels scope", async () => {

await expect(  
scope({ timeout: 10 }, async s => {

```
  s.spawn(async () => {
    await sleep(50)
  })

})
```

).rejects.toThrow()

})

---

### Task finishes before timeout

Writing

test("task completes before timeout", async () => {

const result = await scope({ timeout: 100 }, async s => {

```
const t = s.spawn(async () => {
  await sleep(10)
  return 7
})

return await t
```

})

expect(result).toBe(7)

})

---

# 8. Scheduler Fairness Tests

### Yield scheduling

Writing

test("yield allows other tasks", async () => {

const order: number[] = []

await scope(async s => {

```
s.spawn(async () => {
  order.push(1)
  await yieldNow()
  order.push(3)
})

s.spawn(async () => {
  order.push(2)
})
```

})

expect(order).toEqual([1,2,3])

})

---

# 9. Nested Scope Tests

### Nested scopes complete

Writing

test("nested scopes complete", async () => {

let ran = false

await scope(async s => {

```
s.spawn(async () => {

  await scope(async inner => {

    inner.spawn(async () => {
      ran = true
    })

  })

})
```

})

expect(ran).toBe(true)

})

---

# 10. Stress Tests

Stress tests expose scheduler bugs.

### Many tasks

Writing

test("many tasks", async () => {

let count = 0

await scope(async s => {

```
for (let i = 0; i < 1000; i++) {
  s.spawn(() => count++)
}
```

})

expect(count).toBe(1000)

})

---

### Many nested scopes

Writing

test("nested stress", async () => {

await scope(async s => {

```
for (let i = 0; i < 50; i++) {

  s.spawn(async () => {

    await scope(async inner => {

      inner.spawn(async () => {})

    })

  })

}
```

})

})

---

# 11. Race Condition Tests

These detect subtle bugs.

### Error vs cancel race

Writing

test("error cancel race", async () => {

await expect(  
scope(async s => {

```
  s.spawn(async () => {
    await sleep(5)
    throw new Error("fail")
  })

  await sleep(2)

  s.cancel()

})
```

).rejects.toBeDefined()

})

---

# 12. Recommended Test Count

A production-ready runtime should have roughly:

scope tests           20  
task lifecycle        20  
cancellation          20  
limits                15  
resources             15  
timeouts              10  
scheduler fairness    10  
nested scopes         10  
stress tests          10

Total:

~130 tests

---

# 13. Test Environments

Tests should run in:

Node  
Bun  
Deno  
Browser (optional)

CI matrix ensures runtime portability.

---

# 14. CI Requirements

Each commit should run:

unit tests  
stress tests  
race tests

Example pipeline:

npm test  
npm run stress  
npm run typecheck

---

# 15. Final Test Coverage Goal

Jolly v1 should guarantee that tests cover:

task state machine  
scope invariants  
cancellation propagation  
resource safety  
scheduler correctness  
concurrency limits  
timeouts  
nested scopes

If these areas are covered thoroughly, the runtime will be **production-safe**.

---
---
elow is the **exact minimal public API surface for Jolly v1**, followed by **idiomatic usage examples**.  
The goal is to keep the surface **small, stable, and orthogonal**.

---

# 1. Public API Surface (Exact Exports)

// index.ts  
  
// core  
export function scope<T>(  
  fn: (s: Scope) => Promise<T> | T  
): Promise<T>  
  
export function scope<T>(  
  options: ScopeOptions,  
  fn: (s: Scope) => Promise<T> | T  
): Promise<T>  
  
// scheduling primitives  
export function sleep(ms: number): Promise<void>  
export function yieldNow(): Promise<void>  
  
// types  
export interface Scope {  
  spawn<T>(fn: () => Promise<T> | T): Task<T>  
  
  resource<T>(  
    value: Promise<T> | T,  
    disposer: (value: T) => Promise<void> | void  
  ): Promise<T>  
  
  cancel(reason?: any): void  
  
  readonly signal: AbortSignal  
}  
  
export interface Task<T> extends PromiseLike<T> {  
  readonly id: number  
  readonly state: "running" | "completed" | "failed" | "cancelled"  
}  
  
export interface ScopeOptions {  
  timeout?: number  
  deadline?: number  
  limit?: number  
  signal?: AbortSignal  
}  
  
// errors  
export class TimeoutError extends Error {}

That is the **entire public API**.

No additional classes, no configuration objects, no globals.

---

# 2. Design Characteristics

The API has these properties:

single entry point (scope)  
no global state  
no class instantiation  
no hidden lifecycle

Everything flows through:

scope → spawn → await

---

# 3. Core Usage Patterns

## 3.1 Basic Parallel Tasks

import { scope } from "jolly"  
  
await scope(async s => {  
  
  const user = s.spawn(fetchUser)  
  const posts = s.spawn(fetchPosts)  
  
  return {  
    user: await user,  
    posts: await posts  
  }  
  
})

Semantics:

runs in parallel  
waits for both  
fails fast if either fails

---

## 3.2 Sequential Within Parallel

await scope(async s => {  
  
  const user = await s.spawn(fetchUser)  
  
  const posts = s.spawn(() => fetchPosts(user.id))  
  
  return await posts  
  
})

---

## 3.3 Error Propagation (Fail Fast)

await scope(async s => {  
  
  s.spawn(async () => {  
    throw new Error("fail")  
  })  
  
  s.spawn(async () => {  
    await sleep(100)  
    console.log("never runs")  
  })  
  
})

Behavior:

first error thrown  
second task cancelled  
scope rejects

---

## 3.4 Timeout

import { scope, TimeoutError } from "jolly"  
  
await scope({ timeout: 1000 }, async s => {  
  
  s.spawn(async () => {  
    await sleep(5000)  
  })  
  
})

Result:

throws TimeoutError

---

## 3.5 Deadline

await scope(  
  { deadline: Date.now() + 1000 },  
  async s => {  
  
    s.spawn(longRunningTask)  
  
  }  
)

---

## 3.6 Concurrency Limits

await scope({ limit: 5 }, async s => {  
  
  for (const url of urls) {  
  
    s.spawn(() => fetch(url))  
  
  }  
  
})

Guarantee:

max 5 concurrent fetches

---

## 3.7 Resource Scoping

await scope(async s => {  
  
  const conn = await s.resource(  
    openConnection(),  
    c => c.close()  
  )  
  
  s.spawn(() => conn.query("SELECT * FROM users"))  
  
})

Guarantee:

connection always closed

---

## 3.8 Manual Cancellation

await scope(async s => {  
  
  s.spawn(async () => {  
    await sleep(1000)  
  })  
  
  s.cancel()  
  
})

---

## 3.9 Integration with Fetch (AbortSignal)

await scope(async s => {  
  
  const res = await s.spawn(() =>  
    fetch(url, { signal: s.signal })  
  )  
  
  return res.json()  
  
})

---

## 3.10 Cooperative Yielding

await scope(async s => {  
  
  s.spawn(async () => {  
  
    for (let i = 0; i < 1000; i++) {  
      await yieldNow()  
    }  
  
  })  
  
})

---

## 3.11 Sleep

await scope(async s => {  
  
  s.spawn(async () => {  
    await sleep(100)  
  })  
  
})

---

## 3.12 Nested Scopes

await scope(async s => {  
  
  s.spawn(async () => {  
  
    await scope(async inner => {  
  
      inner.spawn(taskA)  
      inner.spawn(taskB)  
  
    })  
  
  })  
  
})

Each scope is isolated.

---

## 3.13 Task as Promise

await scope(async s => {  
  
  const task = s.spawn(async () => 42)  
  
  const result = await task  
  
  console.log(result)  
  
})

---

## 3.14 Mixing External Promises

await scope(async s => {  
  
  const t = s.spawn(async () => {  
    const data = await fetch(url)  
    return data.json()  
  })  
  
  return await t  
  
})

Jolly interoperates with native promises.

---

# 4. What Is NOT in the API

To keep the API stable, Jolly v1 intentionally excludes:

no global scheduler config  
no task groups  
no priority system  
no manual task handles  
no event emitters  
no debugging APIs

Everything goes through `scope`.

---

# 5. API Philosophy

The API enforces a mental model:

work lives inside scopes  
tasks belong to scopes  
nothing escapes scopes

Developers never manage:

task lifecycle  
cleanup logic  
cancellation propagation

The runtime does it.

---

# 6. Minimal Surface Summary

The entire Jolly v1 API reduces to:

scope()  
spawn()  
resource()  
cancel()  
sleep()  
yieldNow()

Plus types:

Scope  
Task  
ScopeOptions  
TimeoutError

That’s intentionally small.

---

# 7. Stability Guarantee

Because the surface is minimal:

low API churn  
easy to learn  
hard to misuse

This is critical for ecosystem adoption.

---

# Final Summary

Jolly v1 exposes:

1 core function (scope)  
2 scheduling primitives (sleep, yieldNow)  
1 interface (Scope)  
1 abstraction (Task)  
1 config object (ScopeOptions)  
1 error type (TimeoutError)

And supports all real-world async patterns through composition.
---
---
