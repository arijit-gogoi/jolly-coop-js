export class TimeoutError extends Error {
  constructor(message = "Scope timed out") {
    super(message)
    this.name = "TimeoutError"
  }
}
