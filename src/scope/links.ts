import { escapeRegExp, stripFencedAndInlineCode } from '../text'
import type { KeywordRef, LinkedIssue } from '../types'

export function extractClosingReferences(text: string, defaultRepo: string, keywords: readonly string[]): KeywordRef[] {
  const cleaned = stripFencedAndInlineCode(text)
  const pattern = closingPattern(keywords)
  const refs: KeywordRef[] = []
  const seen = new Set<string>()
  for (const match of cleaned.matchAll(pattern)) {
    const raw = match[1]
    if (!raw) continue
    const parsed = parseRef(raw, defaultRepo)
    if (!parsed) continue
    const key = `${parsed.repo.toLowerCase()}#${parsed.number}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(parsed)
  }
  return refs
}

export function closingPattern(keywords: readonly string[]): RegExp {
  const words = keywords.map((word) => word.trim()).filter(Boolean)
  if (words.length === 0) return /$^/g
  const alternation = words.map((word) => escapeRegExp(word)).join('|')
  const ref = '(#[0-9]+|[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+#[0-9]+|https?:\\/\\/(?:www\\.)?github\\.com\\/[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+\\/issues\\/[0-9]+)'
  return new RegExp(`\\b(?:${alternation})\\b(?:\\s+|\\s*:\\s*|\\s+(?:issue|issues|bug|ticket)\\s+)${ref}`, 'gi')
}

export function parseRef(raw: string, defaultRepo: string): KeywordRef | undefined {
  const url = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([0-9]+)/i.exec(raw)
  if (url?.[1] && url[2] && url[3]) {
    return { repo: `${url[1]}/${url[2]}`, number: Number(url[3]), raw }
  }
  const cross = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([0-9]+)$/.exec(raw)
  if (cross?.[1] && cross[2]) return { repo: cross[1], number: Number(cross[2]), raw }
  const local = /^#([0-9]+)$/.exec(raw)
  if (local?.[1]) return { repo: defaultRepo, number: Number(local[1]), raw }
  return undefined
}

export function mergeLinkedIssues(
  apiIssues: readonly LinkedIssue[],
  keywordRefs: readonly KeywordRef[],
  fetched: ReadonlyMap<string, LinkedIssue | null>,
): LinkedIssue[] {
  const byKey = new Map<string, LinkedIssue>()
  for (const issue of apiIssues) {
    byKey.set(issueKey(issue.repo, issue.number), { ...issue, source: 'api' })
  }
  for (const ref of keywordRefs) {
    const key = issueKey(ref.repo, ref.number)
    const existing = byKey.get(key)
    if (existing) {
      existing.source = existing.source === 'api' ? 'both' : existing.source
      continue
    }
    const loaded = fetched.get(key)
    if (loaded) {
      byKey.set(key, { ...loaded, source: 'closing_keyword' })
      continue
    }
    byKey.set(key, {
      repo: ref.repo,
      number: ref.number,
      title: '',
      body: '',
      url: `https://github.com/${ref.repo}/issues/${ref.number}`,
      source: 'closing_keyword',
      unreadable: 'issue body unavailable',
    })
  }
  return [...byKey.values()].sort((a, b) => a.number - b.number || a.repo.localeCompare(b.repo))
}

export function issueKey(repo: string, number: number): string {
  return `${repo.toLowerCase()}#${number}`
}

export function issueText(issue: LinkedIssue): string {
  return `${issue.title}\n${issue.body}`
}
