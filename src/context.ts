import { asNumber, asRecord, asString } from './text'

export type ResolvedContext =
  | { kind: 'pr'; owner: string; repo: string; number: number; sha: string }
  | { kind: 'skip'; reason: string }
  | { kind: 'error'; reason: string }

export function resolvePrContext(input: {
  eventName: string
  owner: string
  repo: string
  payload: Record<string, unknown>
}): ResolvedContext {
  if (!input.owner || !input.repo) {
    return { kind: 'error', reason: 'GitHub repository context is missing. Run this action inside GitHub Actions.' }
  }
  if (input.eventName === 'pull_request' || input.eventName === 'pull_request_target') {
    const pull = asRecord(input.payload.pull_request)
    const number = asNumber(pull?.number)
    const sha = asString(asRecord(pull?.head)?.sha)
    if (!number || !sha) {
      return {
        kind: 'error',
        reason: 'pull_request payload is missing the pull request number or head SHA. The action is misconfigured.',
      }
    }
    return { kind: 'pr', owner: input.owner, repo: input.repo, number, sha }
  }
  if (input.eventName === 'workflow_run') {
    const run = asRecord(input.payload.workflow_run)
    const sha = asString(run?.head_sha)
    const pulls = Array.isArray(run?.pull_requests) ? run.pull_requests : []
    const number = asNumber(asRecord(pulls[0])?.number)
    if (!number || !sha) {
      return {
        kind: 'skip',
        reason: 'workflow_run is not associated with a pull request; skipping.',
      }
    }
    return { kind: 'pr', owner: input.owner, repo: input.repo, number, sha }
  }
  return {
    kind: 'error',
    reason: `pr-evidence-check only runs on pull_request or workflow_run (got ${input.eventName || 'an empty event'}).`,
  }
}
