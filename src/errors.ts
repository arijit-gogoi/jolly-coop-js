export class TimeoutError extends Error {
  constructor(message = "Scope timed out") {
    super(message)
    this.name = "TimeoutError"
  }
}

export class ScopeDoneError extends Error {
  constructor(message = "Scope done") {
    super(message)
    this.name = "ScopeDoneError"
  }
}
