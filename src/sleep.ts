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
  return new Promise<void>(resolve => {
    schedule(resolve)
  })
}
