/** Collapse whitespace and neutralize @mentions so a comment cannot ping users. */
export function inlineText(value: string, max = 120): string {
  const clean = neutralizeMentions(value.replace(/\s+/g, ' ').trim())
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1)}…`
}

export function neutralizeMentions(value: string): string {
  return value.replace(/@/g, '@\u200b')
}

export function cell(value: string): string {
  return inlineText(value, 400).replace(/\|/g, '\\|').replace(/`/g, "'")
}

export function snippetAround(text: string, token: string, radius = 48): string {
  const hay = text.replace(/\s+/g, ' ').trim()
  const idx = hay.toLowerCase().indexOf(token.toLowerCase())
  if (idx < 0) return inlineText(hay, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(hay.length, idx + token.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < hay.length ? '…' : ''
  return inlineText(`${prefix}${hay.slice(start, end).trim()}${suffix}`, radius * 2 + token.length)
}

export function hasBounded(haystack: string, needle: string, options?: { directory?: boolean }): boolean {
  if (!needle) return false
  const hay = haystack.toLowerCase()
  const ned = needle.toLowerCase()
  let from = 0
  while (from <= hay.length - ned.length) {
    const idx = hay.indexOf(ned, from)
    if (idx < 0) return false
    const prev = idx === 0 ? '' : (haystack[idx - 1] ?? '')
    const next = haystack[idx + needle.length] ?? ''
    const prevOk = prev === '' || /[^A-Za-z0-9_]/.test(prev)
    let nextOk = next === '' || /[^A-Za-z0-9_/]/.test(next)
    if (!nextOk && options?.directory && next === '/') {
      const after = haystack[idx + needle.length + 1] ?? ''
      const afterNext = haystack[idx + needle.length + 2] ?? ''
      const trailingSlash = after === '' || /[^A-Za-z0-9_]/.test(after)
      const dotfile = after === '.' && /[A-Za-z0-9_]/.test(afterNext)
      nextOk = trailingSlash && !dotfile
    }
    if (prevOk && nextOk) return true
    from = idx + 1
  }
  return false
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function stripFencedAndInlineCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
}

export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, ' ')
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

export function issueLabel(prRepo: string, repo: string, number: number): string {
  if (repo.toLowerCase() === prRepo.toLowerCase()) return `#${number}`
  return `${repo}#${number}`
}

export function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function tail(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  return text.slice(text.length - max)
}
