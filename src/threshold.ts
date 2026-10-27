import type { CheckStatus, FailOn } from './types'

export function thresholdFailure(
  failOn: FailOn,
  checks: readonly { name: string; status: CheckStatus }[],
): string | null {
  if (failOn === 'none') return null
  const bad = checks.filter((check) => {
    if (check.status === 'skipped') return false
    if (failOn === 'error') return check.status === 'error'
    return check.status === 'warn' || check.status === 'error'
  })
  if (bad.length === 0) return null
  return `fail-on is ${failOn}: ${bad.map((check) => `${check.name}=${check.status}`).join(', ')}`
}
