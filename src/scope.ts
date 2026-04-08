import type { Scope, ScopeOptions, Task } from "./types.js"
import { TaskImpl } from "./task.js"
import { TimeoutError } from "./errors.js"
import { schedule, runWithSignal, getCurrentSignal } from "./scheduler.js"

class ScopeImpl {
  private abortController = new AbortController()
  private tasks = new Set<TaskImpl<unknown>>()
  private pendingCount = 0
  private resources: Array<{ value: unknown; disposer: (value: any) => Promise<void> | void }> = []
  private cancelled = false
  private firstError: unknown = null
  private hasError = false
  private settled = false
  private _resolveAllTasks!: () => void
  private allTasksSettled: Promise<void>

  // Concurrency limit
  private readonly limit: number | undefined
  private runningCount = 0
  private limitQueue: TaskImpl<unknown>[] = []

  // Timeout
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: ScopeOptions) {
    this.limit = options.limit
    this.allTasksSettled = new Promise<void>(resolve => {
      this._resolveAllTasks = resolve
    })
  }

  get signal(): AbortSignal {
    return this.abortController.signal
  }

  get active(): number {
    return this.pendingCount
  }

  spawn<T>(fn: () => Promise<T> | T): Task<T> {
    const task = new TaskImpl<T>(fn)
    this.tasks.add(task as TaskImpl<unknown>)
    this.pendingCount++

    if (this.cancelled) {
      task.transition("cancelled")
      task.reject(this.abortController.signal.reason ?? new Error("Scope cancelled"))
      this.taskDone()
      return task as unknown as Task<T>
    }

    if (this.limit !== undefined && this.runningCount >= this.limit) {
      this.limitQueue.push(task as TaskImpl<unknown>)
    } else {
      // FIX 1: Increment runningCount at spawn time, not execution time
      if (this.limit !== undefined) this.runningCount++
      this.scheduleTask(task as TaskImpl<unknown>)
    }

    return task as unknown as Task<T>
  }

  private scheduleTask(task: TaskImpl<unknown>): void {
    schedule(() => this.executeTask(task))
  }

  private async executeTask(task: TaskImpl<unknown>): Promise<void> {
    // If scope was cancelled before this task runs
    if (this.cancelled && task.internalState === "created") {
      task.transition("cancelled")
      task.reject(this.abortController.signal.reason ?? new Error("Scope cancelled"))
      // FIX 1: Decrement runningCount in early-cancel path
      if (this.limit !== undefined) {
        this.runningCount--
        this.dequeueNext()
      }
      this.taskDone()
      return
    }

    task.transition("running")
    // runningCount already incremented at spawn/dequeue time

    try {
      const result = await runWithSignal(this.signal, task.fn)

      if (task.internalState !== "running") return // already transitioned

      if (this.cancelled) {
        task.transition("cancelled")
        task.reject(this.abortController.signal.reason ?? new Error("Scope cancelled"))
      } else {
        task.transition("completed")
        task.resolve(result)
      }
    } catch (err) {
      if (task.internalState !== "running") return

      if (this.cancelled) {
        task.transition("cancelled")
        task.reject(this.abortController.signal.reason ?? new Error("Scope cancelled"))
      } else {
        task.transition("failed")
        task.reject(err)
        // FIX 2: Defer scope cancellation — only cancel if error wasn't observed
        Promise.resolve().then(() => {
          if (!task.observed) {
            if (!this.hasError) {
              this.hasError = true
              this.firstError = err
            }
            this.cancel(err)
          }
        })
      }
    } finally {
      if (this.limit !== undefined) {
        this.runningCount--
        this.dequeueNext()
      }
      this.taskDone()
    }
  }

  private dequeueNext(): void {
    while (this.limitQueue.length > 0) {
      const next = this.limitQueue.shift()!
      if (this.cancelled && next.internalState === "created") {
        next.transition("cancelled")
        next.reject(this.abortController.signal.reason ?? new Error("Scope cancelled"))
        this.taskDone()
        continue
      }
      // FIX 1: Increment runningCount at dequeue time
      if (this.limit !== undefined) this.runningCount++
      this.scheduleTask(next)
      break
    }
  }

  private taskDone(): void {
    this.pendingCount--
    if (this.pendingCount === 0 && !this.settled) {
      this.settled = true
      this._resolveAllTasks()
    }
  }

  cancel(reason?: unknown): void {
    if (this.cancelled) return
    this.cancelled = true
    this.abortController.abort(reason ?? new Error("Scope cancelled"))

    // Cancel all queued tasks immediately
    while (this.limitQueue.length > 0) {
      const task = this.limitQueue.shift()!
      if (task.internalState === "created") {
        task.transition("cancelled")
        task.reject(this.abortController.signal.reason)
        this.taskDone()
      }
    }
  }

  async resource<T>(
    value: Promise<T> | T,
    disposer: (value: T) => Promise<void> | void
  ): Promise<T> {
    const resolved = await value
    this.resources.push({ value: resolved, disposer })
    return resolved
  }

  private async cleanupResources(): Promise<void> {
    for (let i = this.resources.length - 1; i >= 0; i--) {
      try {
        await this.resources[i].disposer(this.resources[i].value)
      } catch {
        // Disposer errors are contained
      }
    }
  }

  async run<T>(fn: (s: Scope) => Promise<T> | T): Promise<T> {
    // Wire external signal
    const externalSignal = this.options.signal
    let onExternalAbort: (() => void) | undefined
    if (externalSignal) {
      if (externalSignal.aborted) {
        this.cancel(externalSignal.reason)
      } else {
        onExternalAbort = () => this.cancel(externalSignal.reason)
        externalSignal.addEventListener("abort", onExternalAbort, { once: true })
      }
    }

    // Set up timeout/deadline
    const timeout = this.options.deadline !== undefined
      ? Math.max(0, this.options.deadline - Date.now())
      : this.options.timeout

    if (timeout !== undefined) {
      this.timeoutTimer = setTimeout(() => {
        if (!this.hasError) {
          this.hasError = true
          this.firstError = new TimeoutError()
        }
        this.cancel(this.firstError)
      }, timeout)
    }

    const proxy: Scope = {
      spawn: <U>(fn: () => Promise<U> | U) => this.spawn(fn),
      resource: <U>(value: Promise<U> | U, disposer: (value: U) => Promise<void> | void) =>
        this.resource(value, disposer),
      cancel: (reason?: unknown) => this.cancel(reason),
      get signal() { return this.signal },
      get active() { return 0 },
    }

    Object.defineProperty(proxy, "signal", { get: () => this.signal })
    Object.defineProperty(proxy, "active", { get: () => this.active })

    let rootResult: T | undefined
    let rootThrew = false

    try {
      rootResult = await fn(proxy)
    } catch (err) {
      rootThrew = true
      if (!this.hasError) {
        this.hasError = true
        this.firstError = err
      }
      this.cancel(err)
    }

    // Wait for all tasks
    if (this.pendingCount > 0) {
      await this.allTasksSettled
    }

    // Cleanup resources
    await this.cleanupResources()

    // Clear timeout
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }

    // Remove external signal listener
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener("abort", onExternalAbort)
    }

    // Settle
    if (this.hasError) {
      throw this.firstError
    }
    if (this.cancelled) {
      // If every spawned task reached "completed", cancel had no effect — resolve normally
      let allCompleted = this.tasks.size > 0
      for (const t of this.tasks) {
        if (t.internalState !== "completed") { allCompleted = false; break }
      }
      if (!allCompleted) {
        throw this.abortController.signal.reason ?? new Error("Scope cancelled")
      }
    }
    return rootResult as T
  }
}

export function scope<T>(fn: (s: Scope) => Promise<T> | T): Promise<T>
export function scope<T>(options: ScopeOptions, fn: (s: Scope) => Promise<T> | T): Promise<T>
export function scope<T>(
  optionsOrFn: ScopeOptions | ((s: Scope) => Promise<T> | T),
  maybeFn?: (s: Scope) => Promise<T> | T
): Promise<T> {
  let options: ScopeOptions
  let fn: (s: Scope) => Promise<T> | T

  if (typeof optionsOrFn === "function") {
    options = {}
    fn = optionsOrFn
  } else {
    options = optionsOrFn
    fn = maybeFn!
  }

  // FIX 4: Propagate parent signal to nested scopes
  const parentSignal = getCurrentSignal()
  if (parentSignal && !options.signal) {
    options = { ...options, signal: parentSignal }
  }

  const impl = new ScopeImpl(options)
  return impl.run(fn)
}
