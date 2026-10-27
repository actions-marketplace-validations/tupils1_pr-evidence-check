export type FailureKind = 'misconfigured' | 'threshold' | 'delivery'

/** Failure of the action itself, or an opted-in fail-on threshold. */
export class ActionFailure extends Error {
  readonly kind: FailureKind

  constructor(kind: FailureKind, message: string) {
    super(message)
    this.name = 'ActionFailure'
    this.kind = kind
  }
}

export class GitHubHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GitHubHttpError'
    this.status = status
  }
}
