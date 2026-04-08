import type { TaskState } from "./types.js"

let nextId = 1

const VALID_TRANSITIONS: Record<string, Set<string>> = {
  created:   new Set(["running", "cancelled"]),
  running:   new Set(["completed", "failed", "cancelled"]),
  completed: new Set(),
  failed:    new Set(),
  cancelled: new Set(),
}

export class TaskImpl<T> {
  readonly id: number
  private _state: TaskState = "created"
  private _resolve!: (value: T) => void
  private _reject!: (reason: unknown) => void
  readonly promise: Promise<T>
  readonly fn: () => Promise<T> | T

  constructor(fn: () => Promise<T> | T) {
    this.id = nextId++
    this.fn = fn
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })
  }

  get internalState(): TaskState {
    return this._state
  }

  // Public state: "created" maps to "running" per spec
  get state(): "running" | "completed" | "failed" | "cancelled" {
    return this._state === "created" ? "running" : this._state as "running" | "completed" | "failed" | "cancelled"
  }

  transition(to: TaskState): void {
    if (!VALID_TRANSITIONS[this._state]?.has(to)) {
      throw new Error(`Illegal task transition: ${this._state} → ${to}`)
    }
    this._state = to
  }

  resolve(value: T): void {
    this._resolve(value)
  }

  reject(reason: unknown): void {
    this._reject(reason)
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected)
  }
}
