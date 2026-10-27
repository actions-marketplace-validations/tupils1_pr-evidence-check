import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/config'
import { extractClosingReferences, mergeLinkedIssues, parseRef } from '../src/scope/links'
import type { LinkedIssue } from '../src/types'

const keywords = defaultConfig().scope.closingKeywords

describe('closing references', () => {
  it('reads GitHub closing keywords, cross-repo refs, and issue URLs', () => {
    const text = [
      'Fixes #12 and closes org/repo#3.',
      'This resolved: #8.',
      'Also fix issue #9.',
      'Fixes https://github.com/octo/hello/issues/15.',
      'fixing #1 is not a keyword, and prefix #2 is not either.',
    ].join('\n')
    const refs = extractClosingReferences(text, 'acme/app', keywords)
    expect(refs.map((ref) => `${ref.repo}#${ref.number}`)).toEqual([
      'acme/app#12',
      'org/repo#3',
      'acme/app#8',
      'acme/app#9',
      'octo/hello#15',
    ])
  })

  it('ignores examples inside fenced blocks and inline code', () => {
    const text = [
      '```',
      'Fixes #99',
      '```',
      'The template says `fixes #98`.',
      'Fixes #7',
    ].join('\n')
    const refs = extractClosingReferences(text, 'acme/app', keywords)
    expect(refs.map((ref) => ref.number)).toEqual([7])
  })

  it('dedupes the same issue and honors a custom keyword', () => {
    const text = 'Fixes #4. fixes #4. implements #5.'
    expect(extractClosingReferences(text, 'acme/app', keywords).map((ref) => ref.number)).toEqual([4])
    expect(extractClosingReferences(text, 'acme/app', ['implements']).map((ref) => ref.number)).toEqual([5])
  })

  it('parses a www GitHub URL', () => {
    expect(parseRef('https://www.github.com/octo/hello/issues/15', 'acme/app')).toEqual({
      repo: 'octo/hello',
      number: 15,
      raw: 'https://www.github.com/octo/hello/issues/15',
    })
  })
})

describe('merge linked issues', () => {
  it('keeps API issues, fills keyword-only issues, and records unreadable ones', () => {
    const api: LinkedIssue[] = [{
      repo: 'acme/app',
      number: 4,
      title: 'From API',
      body: 'session',
      url: 'https://github.com/acme/app/issues/4',
      source: 'api',
    }]
    const fetched = new Map<string, LinkedIssue | null>([
      ['acme/app#5', {
        repo: 'acme/app',
        number: 5,
        title: 'Fetched',
        body: 'body',
        url: 'https://github.com/acme/app/issues/5',
        source: 'closing_keyword',
      }],
      ['acme/app#6', null],
    ])
    const merged = mergeLinkedIssues(
      api,
      [
        { repo: 'acme/app', number: 4, raw: '#4' },
        { repo: 'acme/app', number: 5, raw: '#5' },
        { repo: 'acme/app', number: 6, raw: '#6' },
      ],
      fetched,
    )
    expect(merged.map((issue) => [issue.number, issue.source, issue.unreadable])).toEqual([
      [4, 'both', undefined],
      [5, 'closing_keyword', undefined],
      [6, 'closing_keyword', 'issue body unavailable'],
    ])
  })
})
