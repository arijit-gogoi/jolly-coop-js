import { schedule } from "./scheduler.js"

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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

export function yieldNow(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    schedule(() => {
      if (signal?.aborted) {
        reject(signal.reason)
      } else {
        resolve()
      }
    })
  })
}
