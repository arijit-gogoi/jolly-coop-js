const MAX_TASKS = 500
const MAX_TIME = 5 // milliseconds

type Callback = () => void

const queue: Callback[] = []
let scheduled = false

// Platform-adaptive trigger: MessageChannel primary, setTimeout fallback
const trigger: () => void = (() => {
  if (typeof MessageChannel !== "undefined") {
    const channel = new MessageChannel()
    channel.port1.onmessage = drain
    return () => channel.port2.postMessage(0)
  }
  return () => setTimeout(drain, 0)
})()

function drain() {
  scheduled = false
  let count = 0
  const start = performance.now()

  while (queue.length > 0) {
    const cb = queue.shift()!
    cb()

    if (++count >= MAX_TASKS || performance.now() - start > MAX_TIME) {
      if (queue.length > 0) {
        scheduleNextTick()
      }
      return
    }
  }
}

function scheduleNextTick() {
  if (!scheduled) {
    scheduled = true
    trigger()
  }
}

export function schedule(callback: Callback): void {
  queue.push(callback)
  scheduleNextTick()
}

// Execution context: tracks the active scope's AbortSignal
let _currentSignal: AbortSignal | null = null

export function runWithSignal<T>(signal: AbortSignal, fn: () => T): T {
  const prev = _currentSignal
  _currentSignal = signal
  try {
    return fn()
  } finally {
    _currentSignal = prev
  }
}

export function getCurrentSignal(): AbortSignal | null {
  return _currentSignal
}
