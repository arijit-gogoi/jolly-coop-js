const MAX_TASKS = 500
const MAX_TIME = 5 // milliseconds

type Callback = () => void

// Ring buffer queue — O(1) push and shift, avoids Array.shift() O(n) at scale
let _buf: (Callback | undefined)[] = new Array(1024)
let _head = 0
let _tail = 0
let _size = 0

function qPush(cb: Callback) {
  if (_size === _buf.length) {
    // Double capacity and repack
    const len = _buf.length
    const next = new Array(len * 2) as (Callback | undefined)[]
    for (let i = 0; i < _size; i++) next[i] = _buf[(_head + i) % len]
    _buf = next
    _head = 0
    _tail = _size
  }
  _buf[_tail] = cb
  _tail = (_tail + 1) % _buf.length
  _size++
}

function qShift(): Callback | undefined {
  if (_size === 0) return undefined
  const cb = _buf[_head]
  _buf[_head] = undefined // release reference
  _head = (_head + 1) % _buf.length
  _size--
  return cb
}

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

  while (_size > 0) {
    const cb = qShift()!
    cb()

    if (++count >= MAX_TASKS || performance.now() - start > MAX_TIME) {
      if (_size > 0) {
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
  qPush(callback)
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
