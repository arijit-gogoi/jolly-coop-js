import { schedule, getCurrentSignal } from "./scheduler.js"

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const signal = getCurrentSignal()

    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      reject(signal!.reason)
    }

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
    }
  })
}

export function yieldNow(): Promise<void> {
  const signal = getCurrentSignal()
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    schedule(() => {
      if (signal) {
        // Signal-aware: defer by one microtask so peer immediate-resolves
        // (e.g. root-fn resume → cancel) fire their continuations first
        queueMicrotask(() => {
          if (signal.aborted) {
            reject(signal.reason)
          } else {
            resolve()
          }
        })
      } else {
        // No signal context: resolve immediately
        resolve()
      }
    })
  })
}
