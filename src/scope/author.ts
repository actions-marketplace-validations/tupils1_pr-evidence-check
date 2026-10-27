export function isBotAuthor(login: string | undefined, userType?: string): boolean {
  if ((userType ?? '').trim().toLowerCase() === 'bot') return true
  const name = (login ?? '').trim()
  if (!name) return false
  if (/\[bot\]$/i.test(name)) return true
  return /^(dependabot|renovate)$/i.test(name)
}

export function matchingSkipLabel(labels: readonly string[], skipLabels: readonly string[]): string | undefined {
  const wanted = new Set(skipLabels.map((label) => label.trim().toLowerCase()).filter((label) => label.length > 0))
  if (wanted.size === 0) return undefined
  for (const label of labels) {
    const trimmed = label.trim()
    if (wanted.has(trimmed.toLowerCase())) return trimmed
  }
  return undefined
}
