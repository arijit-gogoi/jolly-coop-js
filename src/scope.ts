import type { Scope, ScopeOptions, Task } from "./types.js"
import { TaskImpl } from "./task.js"
import { TimeoutError, ScopeDoneError } from "./errors.js"
import { schedule } from "./scheduler.js"

class ScopeImpl {
  private abortController = new AbortController()
  private pendingCount = 0
  private resources: Array<{ value: unknown; disposer: (value: any) => Promise<void> | void }> = []
  private cancelled = false
  private firstError: unknown = undefined
  private hasError = false
  private _doneGracefully = false
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
    if (options.limit !== undefined) {
      if (!Number.isFinite(options.limit) || options.limit <= 0 || !Number.isInteger(options.limit)) {
        throw new TypeError("limit must be a positive integer")
      }
    }
    if (options.timeout !== undefined) {
      if (!Number.isFinite(options.timeout) || options.timeout < 0) {
        throw new TypeError("timeout must be a non-negative finite number")
      }
    }
    if (options.deadline !== undefined) {
      if (!Number.isFinite(options.deadline)) {
        throw new TypeError("deadline must be a finite number")
      }
    }
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

  private get cancelReason(): unknown {
    return this.abortController.signal.reason ?? new Error("Scope cancelled")
  }

  spawn<T>(fn: () => Promise<T> | T): Task<T> {
    const task = new TaskImpl<T>(fn)
    task._scope = this
    this.pendingCount++

    if (this.cancelled) {
      task.transition("cancelled")
      task.reject(this.cancelReason)
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
    schedule(task)
  }

  /** @internal — called by TaskImpl._run() via scheduler */
  executeTask(task: TaskImpl<unknown>): void {
    // If scope was cancelled before this task runs
    if (this.cancelled && task.internalState === "created") {
      task.transition("cancelled")
      task.reject(this.cancelReason)
      if (this.limit !== undefined) {
        this.runningCount--
        this.dequeueNext()
      }
      this.taskDone()
      return
    }

    task.transition("running")

    let result: unknown
    try {
      result = task.fn()
    } catch (err) {
      // Synchronous throw
      this.handleTaskError(task, err)
      this.handleTaskFinally()
      return
    }

    // Detect promise vs sync result
    if (result != null && typeof (result as any).then === "function") {
      // Async path — task returned a promise/thenable
      ;(result as Promise<unknown>).then(
        value => this.handleTaskSuccess(task, value),
        err => this.handleTaskError(task, err)
      ).then(() => this.handleTaskFinally())
    } else {
      // Sync fast path — no await overhead
      this.handleTaskSuccess(task, result)
      this.handleTaskFinally()
    }
  }

  private handleTaskSuccess(task: TaskImpl<unknown>, value: unknown): void {
    if (task.internalState !== "running") return
    if (this.cancelled) {
      task.transition("cancelled")
      task.reject(this.cancelReason)
    } else {
      task.transition("completed")
      task.resolve(value)
    }
  }

  private handleTaskError(task: TaskImpl<unknown>, err: unknown): void {
    if (task.internalState !== "running") return
    if (this.cancelled) {
      task.transition("cancelled")
      task.reject(this.cancelReason)
    } else {
      task.transition("failed")
      task.reject(err)
      // Defer scope cancellation — only cancel if error wasn't observed
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
  }

  private handleTaskFinally(): void {
    if (this.limit !== undefined) {
      this.runningCount--
      this.dequeueNext()
    }
    this.taskDone()
  }

  private dequeueNext(): void {
    while (this.limitQueue.length > 0) {
      const next = this.limitQueue.shift()!
      if (this.cancelled && next.internalState === "created") {
        next.transition("cancelled")
        next.reject(this.cancelReason)
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
        task.reject(this.cancelReason)
          this.taskDone()
      }
    }
  }

  done(): void {
    if (this.cancelled) return
    this._doneGracefully = true
    this.cancel(new ScopeDoneError())
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

    const proxy = {
      spawn: <U>(fn: () => Promise<U> | U) => this.spawn(fn),
      resource: <U>(value: Promise<U> | U, disposer: (value: U) => Promise<void> | void) =>
        this.resource(value, disposer),
      cancel: (reason?: unknown) => this.cancel(reason),
      done: () => this.done(),
    } as Scope

    Object.defineProperty(proxy, "signal", { get: () => this.signal, enumerable: true })
    Object.defineProperty(proxy, "active", { get: () => this.active, enumerable: true })

    let rootResult: T | undefined

    try {
      rootResult = await fn(proxy)
    } catch (err) {
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
    if (this.cancelled && !this._doneGracefully) {
      throw this.cancelReason
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

  const impl = new ScopeImpl(options)
  return impl.run(fn)
}
