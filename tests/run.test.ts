import { describe, expect, it } from 'vitest'
import { ActionFailure } from '../src/errors'
import type { GitHubClient, PullRequestInfo } from '../src/github/client'
import { MARKER } from '../src/render'
import { run, type ActionIO, type RunInput } from '../src/run'
import type { ChangedFile, CheckRunInfo, LinkedIssue, WorkflowJobInfo } from '../src/types'

const SHA = 'a'.repeat(40)

function pull(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 7,
    title: 'Fix session timeout',
    body: [
      'Fixes #12',
      '## Intent',
      'Refresh the session token before it expires.',
      '## Risks',
      'Login could loop if refresh fails.',
      '## Tests run',
      'CI unit job passed.',
      '## Self-verification',
      'I logged in locally and waited past the old timeout.',
    ].join('\n'),
    headSha: SHA,
    baseSha: 'b'.repeat(40),
    baseRef: 'main',
    ...overrides,
  }
}

class FakeClient {
  comments: { id: number; body: string }[] = []
  created = 0
  updated = 0
  files: ChangedFile[] = [{ filename: 'src/auth/session.ts', status: 'modified', additions: 12, deletions: 1 }]
  jobs: WorkflowJobInfo[] = [{
    id: 9,
    name: 'unit',
    workflowName: 'CI',
    status: 'completed',
    conclusion: 'success',
    htmlUrl: 'https://example.test/job',
    runId: 1,
  }]
  checks: CheckRunInfo[] = []
  issues: LinkedIssue[] = [{
    repo: 'acme/app',
    number: 12,
    title: 'Session timeout on login',
    body: 'The session token expires during login.',
    url: 'https://github.com/acme/app/issues/12',
    source: 'api',
  }]
  configText: string | null = null
  configError?: string
  fileError?: string
  commentError?: string
  logText = 'Tests:       4 passed, 4 total\nSECRET_TOKEN=abc'
  listFilesCalled = 0

  client(): GitHubClient {
    return {
      getPullRequest: async () => pull(this.pullOverrides),
      getRepoFile: async () => ({ text: this.configText, ...(this.configError ? { error: this.configError } : {}) }),
      listFiles: async () => {
        this.listFilesCalled += 1
        if (this.fileError) throw new Error(this.fileError)
        return this.files
      },
      listClosingIssues: async () => ({ issues: this.issues }),
      getIssue: async () => null,
      listCheckRuns: async () => this.checks,
      listWorkflowJobs: async () => this.jobs,
      getJobLog: async () => ({ text: this.logText }),
      listComments: async () => this.comments,
      createComment: async (_number, body) => {
        if (this.commentError) throw Object.assign(new Error(this.commentError), { status: 403 })
        this.created += 1
        this.comments.push({ id: 10, body })
        return { id: 10, url: 'https://example.test/comment/10' }
      },
      updateComment: async (id, body) => {
        this.updated += 1
        const existing = this.comments.find((comment) => comment.id === id)
        if (existing) existing.body = body
        return { id, url: `https://example.test/comment/${id}` }
      },
    }
  }

  pullOverrides: Partial<PullRequestInfo> = {}
}

function io(): ActionIO & { outputs: Record<string, string>; summary: string; warnings: string[]; infos: string[] } {
  const outputs: Record<string, string> = {}
  const warnings: string[] = []
  const infos: string[] = []
  let summary = ''
  return {
    outputs,
    warnings,
    infos,
    get summary() {
      return summary
    },
    info: (message) => infos.push(message),
    warning: (message) => warnings.push(message),
    setOutput: (name, value) => {
      outputs[name] = value
    },
    writeSummary: async (markdown) => {
      summary = markdown
    },
  }
}

function input(overrides: Partial<RunInput> = {}): RunInput {
  return {
    token: 'token',
    configPath: '.github/pr-evidence.yml',
    failOn: 'none',
    commentLanguage: '',
    eventName: 'pull_request',
    owner: 'acme',
    repo: 'app',
    payload: { pull_request: { number: 7, head: { sha: SHA } } },
    ...overrides,
  }
}

describe('run', () => {
  it('posts one sticky comment for a clean pull request and does not fail', async () => {
    const fake = new FakeClient()
    const actions = io()
    const result = await run({
      io: actions,
      input: input(),
      createClient: () => fake.client(),
      now: () => new Date('2026-10-27T00:00:00.000Z'),
    })
    expect(result.commentUrl).toBe('https://example.test/comment/10')
    expect(fake.created).toBe(1)
    expect(fake.comments[0]?.body).toContain(MARKER)
    expect(fake.comments[0]?.body).toContain('In scope for #12')
    expect(fake.comments[0]?.body).not.toContain('SECRET_TOKEN')
    expect(actions.outputs['scope-status']).toBe('pass')
    expect(actions.outputs['test-evidence-status']).toBe('pass')
    expect(actions.outputs['review-packet-status']).toBe('pass')
    expect(actions.summary).toContain('PR evidence')
  })

  it('updates the existing sticky comment instead of creating another', async () => {
    const fake = new FakeClient()
    fake.comments = [{ id: 4, body: `${MARKER}\nold` }, { id: 5, body: `${MARKER}\ndupe` }]
    const actions = io()
    await run({ io: actions, input: input(), createClient: () => fake.client(), now: () => new Date('2026-10-27T00:00:00.000Z') })
    expect(fake.created).toBe(0)
    expect(fake.updated).toBe(1)
    expect(fake.comments[0]?.body).toContain('path tokens')
    expect(actions.warnings.some((warning) => warning.includes('oldest'))).toBe(true)
  })

  it('stays green when checks warn unless fail-on says otherwise', async () => {
    const fake = new FakeClient()
    fake.files = [{ filename: 'src/billing/invoice.ts', status: 'modified', additions: 4, deletions: 0 }]
    fake.jobs = []
    await expect(run({
      io: io(),
      input: input({ failOn: 'none' }),
      createClient: () => fake.client(),
      now: () => new Date('2026-10-27T00:00:00.000Z'),
    })).resolves.toMatchObject({ commentUrl: 'https://example.test/comment/10' })
    expect(fake.comments[0]?.body).toContain('`scope.outside`')
    expect(fake.comments[0]?.body).toContain('test_evidence.none')

    await expect(run({
      io: io(),
      input: input({ failOn: 'warning' }),
      createClient: () => fake.client(),
      now: () => new Date('2026-10-27T00:00:00.000Z'),
    })).rejects.toMatchObject({ kind: 'threshold' })

    fake.files = [
      { filename: 'src/auth/session.ts', status: 'modified', additions: 1, deletions: 0 },
      { filename: 'src/billing/invoice.ts', status: 'modified', additions: 1, deletions: 0 },
      { filename: 'src/billing/tax.ts', status: 'modified', additions: 1, deletions: 0 },
      { filename: 'src/billing/refund.ts', status: 'modified', additions: 1, deletions: 0 },
    ]
    fake.jobs = [{ id: 1, name: 'unit', workflowName: 'CI', status: 'completed', conclusion: 'success', runId: 1 }]
    await expect(run({
      io: io(),
      input: input({ failOn: 'error' }),
      createClient: () => fake.client(),
      now: () => new Date('2026-10-27T00:00:00.000Z'),
    })).rejects.toMatchObject({ kind: 'threshold', message: expect.stringContaining('scope=error') })
  })

  it('reads config from the base ref and ignores a pull request that would disable checks', async () => {
    const fake = new FakeClient()
    fake.configText = 'checks:\n  review-packet: false\n'
    const actions = io()
    await run({ io: actions, input: input(), createClient: () => fake.client(), now: () => new Date('2026-10-27T00:00:00.000Z') })
    expect(actions.outputs['review-packet-status']).toBe('skipped')
    expect(fake.comments[0]?.body).toContain('Disabled in config')
  })

  it('does not list files when scope is disabled, and still comments if the files API fails', async () => {
    const disabled = new FakeClient()
    disabled.configText = 'checks:\n  scope: false\n'
    await run({ io: io(), input: input(), createClient: () => disabled.client(), now: () => new Date('2026-10-27T00:00:00.000Z') })
    expect(disabled.listFilesCalled).toBe(0)

    const broken = new FakeClient()
    broken.fileError = 'GitHub API 500'
    const actions = io()
    await run({ io: actions, input: input(), createClient: () => broken.client(), now: () => new Date('2026-10-27T00:00:00.000Z') })
    expect(actions.outputs['scope-status']).toBe('warn')
    expect(broken.comments[0]?.body).toContain('scope.api_error')
    expect(broken.comments[0]?.body).not.toContain('changes no files')
  })

  it('skips a workflow_run with no pull request and fails on a push or a bad token', async () => {
    let created = 0
    const result = await run({
      io: io(),
      input: input({ eventName: 'workflow_run', payload: { workflow_run: { head_sha: SHA, pull_requests: [] } } }),
      createClient: () => {
        created += 1
        return new FakeClient().client()
      },
    })
    expect(result.skipped).toBe(true)
    expect(created).toBe(0)

    await expect(run({
      io: io(),
      input: input({ eventName: 'push', payload: {} }),
      createClient: () => new FakeClient().client(),
    })).rejects.toMatchObject({ kind: 'misconfigured' })

    await expect(run({
      io: io(),
      input: input({ token: '  ' }),
      createClient: () => new FakeClient().client(),
    })).rejects.toBeInstanceOf(ActionFailure)

    await expect(run({
      io: io(),
      input: input({ failOn: 'sometimes' }),
      createClient: () => new FakeClient().client(),
    })).rejects.toMatchObject({ kind: 'misconfigured' })
  })

  it('fails when the token cannot comment or the base config is invalid', async () => {
    const denied = new FakeClient()
    const client = denied.client()
    const { GitHubHttpError } = await import('../src/errors')
    client.createComment = async () => {
      throw new GitHubHttpError(403, 'nope')
    }
    await expect(run({
      io: io(),
      input: input(),
      createClient: () => client,
      now: () => new Date('2026-10-27T00:00:00.000Z'),
    })).rejects.toMatchObject({ kind: 'delivery' })

    const invalid = new FakeClient()
    invalid.configText = 'scope:\n  large-diff-lines: "nope"\n'
    await expect(run({
      io: io(),
      input: input(),
      createClient: () => invalid.client(),
      now: () => new Date('2026-10-27T00:00:00.000Z'),
    })).rejects.toMatchObject({ kind: 'misconfigured' })
  })

  it('notes a head SHA that moved and honors the comment language', async () => {
    const fake = new FakeClient()
    fake.pullOverrides = { headSha: 'c'.repeat(40) }
    const actions = io()
    await run({
      io: actions,
      input: input({ commentLanguage: 'zh' }),
      createClient: () => fake.client(),
      now: () => new Date('2026-10-27T00:00:00.000Z'),
    })
    expect(fake.comments[0]?.body).toContain('test_evidence.sha_mismatch')
    expect(fake.comments[0]?.body).toContain('PR 证据')
  })

  it('warns and uses defaults when the base config cannot be read', async () => {
    const fake = new FakeClient()
    fake.configError = 'GitHub API 403'
    const actions = io()
    await run({ io: actions, input: input(), createClient: () => fake.client(), now: () => new Date('2026-10-27T00:00:00.000Z') })
    expect(actions.warnings.some((warning) => warning.includes('Using defaults'))).toBe(true)
    expect(actions.outputs['scope-status']).toBe('pass')
  })
})
