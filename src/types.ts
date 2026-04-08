export interface Scope {
  spawn<T>(fn: () => Promise<T> | T): Task<T>
  resource<T>(
    value: Promise<T> | T,
    disposer: (value: T) => Promise<void> | void
  ): Promise<T>
  cancel(reason?: unknown): void
  readonly signal: AbortSignal
  readonly active: number
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

export type TaskState = "created" | "running" | "completed" | "failed" | "cancelled"
