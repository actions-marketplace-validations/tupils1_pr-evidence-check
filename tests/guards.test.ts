import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePrContext } from '../src/context'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

describe('guards', () => {
  it('does not call an LLM or spawn tests', () => {
    const forbidden = /api\.openai\.com|api\.anthropic\.com|generativelanguage|child_process|openai/i
    for (const file of sourceFiles(path.join(__dirname, '../src'))) {
      expect(readFileSync(file, 'utf8')).not.toMatch(forbidden)
    }
  })

  it('resolves pull_request, workflow_run, and rejects other events', () => {
    expect(resolvePrContext({
      eventName: 'pull_request',
      owner: 'acme',
      repo: 'app',
      payload: { pull_request: { number: 4, head: { sha: 'abc' } } },
    })).toMatchObject({ kind: 'pr', number: 4, sha: 'abc' })
    expect(resolvePrContext({
      eventName: 'workflow_run',
      owner: 'acme',
      repo: 'app',
      payload: { workflow_run: { head_sha: 'abc', pull_requests: [{ number: 9 }] } },
    })).toMatchObject({ kind: 'pr', number: 9 })
    expect(resolvePrContext({
      eventName: 'workflow_run',
      owner: 'acme',
      repo: 'app',
      payload: { workflow_run: { head_sha: 'abc', pull_requests: [] } },
    }).kind).toBe('skip')
    expect(resolvePrContext({
      eventName: 'pull_request',
      owner: 'acme',
      repo: 'app',
      payload: {},
    }).kind).toBe('error')
    expect(resolvePrContext({ eventName: 'push', owner: '', repo: '', payload: {} }).kind).toBe('error')
  })
})
