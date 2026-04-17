const MAX_TASKS = 5000
const MAX_TIME = 5 // milliseconds
const INITIAL_BUFFER = 131072 // pre-allocate for 100k+ workloads without resize

// Schedulable: plain callback or object with _run() — avoids per-task closure allocation
type Schedulable = (() => void) | { _run(): void }

// Ring buffer queue — O(1) push and shift, power-of-2 sizes for bitwise wrap
let _buf: (Schedulable | undefined)[] = new Array(INITIAL_BUFFER)
let _mask = INITIAL_BUFFER - 1
let _head = 0
let _tail = 0
let _size = 0

function qPush(entry: Schedulable) {
  if (_size === _buf.length) {
    const len = _buf.length
    const next = new Array(len * 2) as (Schedulable | undefined)[]
    for (let i = 0; i < _size; i++) next[i] = _buf[(_head + i) & _mask]
    _buf = next
    _mask = next.length - 1
    _head = 0
    _tail = _size
  }
  _buf[_tail] = entry
  _tail = (_tail + 1) & _mask
  _size++
}

function qShift(): Schedulable | undefined {
  if (_size === 0) return undefined
  const entry = _buf[_head]
  _buf[_head] = undefined
  _head = (_head + 1) & _mask
  _size--
  return entry
}

let scheduled = false

// Platform-adaptive trigger: MessageChannel primary, setTimeout fallback
// idle() nulls the onmessage handler so the port doesn't keep the event loop alive
function shrinkIfNeeded() {
  if (_buf.length > INITIAL_BUFFER) {
    _buf = new Array(INITIAL_BUFFER)
    _mask = INITIAL_BUFFER - 1
    _head = 0
    _tail = 0
  }
}

const { trigger, idle } = (() => {
  if (typeof MessageChannel !== "undefined") {
    const channel = new MessageChannel()
    return {
      trigger: () => {
        channel.port1.onmessage = drain
        channel.port2.postMessage(0)
      },
      idle: () => {
        channel.port1.onmessage = null
        scheduled = false
        shrinkIfNeeded()
      },
    }
  }
  return {
    trigger: () => setTimeout(drain, 0),
    idle: () => { shrinkIfNeeded() },
  }
})()

function drain() {
  scheduled = false
  let count = 0
  const start = performance.now()

  while (_size > 0) {
    const entry = qShift()!
    if (typeof entry === "function") entry()
    else entry._run()

    if (++count >= MAX_TASKS || (count & 31) === 0 && performance.now() - start > MAX_TIME) {
      if (_size > 0) {
        scheduleNextTick()
      } else {
        idle()
      }
      return
    }
  }
  idle()
}

function scheduleNextTick() {
  if (!scheduled) {
    scheduled = true
    trigger()
  }
}

export function schedule(entry: Schedulable): void {
  qPush(entry)
  scheduleNextTick()
}

export function _resetScheduler(): void {
  _buf = new Array(INITIAL_BUFFER)
  _mask = INITIAL_BUFFER - 1
  _head = 0
  _tail = 0
  _size = 0
  scheduled = false
}
