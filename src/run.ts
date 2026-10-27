import { loadConfig, parseFailOn, parseLanguage } from './config'
import { resolvePrContext } from './context'
import { ActionFailure, GitHubHttpError } from './errors'
import { buildEvidence, selectEvidence, skippedEvidence } from './evidence/select'
import type { GitHubClient } from './github/client'
import { analyzePacket, skippedPacket } from './packet/analyze'
import { renderComment, renderSummary } from './render'
import { analyzeScope, skippedScope } from './scope/analyze'
import { extractClosingReferences, issueKey, mergeLinkedIssues } from './scope/links'
import { findSticky } from './sticky'
import { thresholdFailure } from './threshold'
import type { EvidenceItem, LinkedIssue, Report } from './types'

export interface ActionIO {
  info(message: string): void
  warning(message: string): void
  setOutput(name: string, value: string): void
  writeSummary(markdown: string): Promise<void>
}

export interface RunInput {
  token: string
  configPath: string
  failOn: string
  commentLanguage: string
  eventName: string
  owner: string
  repo: string
  payload: Record<string, unknown>
}

export async function run(deps: {
  io: ActionIO
  input: RunInput
  createClient: (token: string, owner: string, repo: string) => GitHubClient
  now?: () => Date
}): Promise<{ commentUrl?: string; skipped?: boolean }> {
  const context = resolvePrContext(deps.input)
  if (context.kind === 'skip') {
    deps.io.info(context.reason)
    return { skipped: true }
  }
  if (context.kind === 'error') throw new ActionFailure('misconfigured', context.reason)
  if (!deps.input.token.trim()) {
    throw new ActionFailure('misconfigured', 'The token input is empty.')
  }
  const failOn = parseFailOn(deps.input.failOn)
  const client = deps.createClient(deps.input.token, context.owner, context.repo)
  const prRepo = `${context.owner}/${context.repo}`

  let pr
  try {
    pr = await client.getPullRequest(context.number)
  } catch (error) {
    throw new ActionFailure('misconfigured', `Cannot read pull request #${context.number}: ${errorMessage(error)} Grant pull-requests: read.`)
  }

  const configFile = await client.getRepoFile(deps.input.configPath, pr.baseSha)
  if (configFile.error) {
    deps.io.warning(`Could not read ${deps.input.configPath} at ${pr.baseSha}: ${configFile.error}. Using defaults.`)
  } else if (configFile.text == null) {
    deps.io.info(`No ${deps.input.configPath} on the base branch. Using defaults.`)
  }
  const config = loadConfig(configFile.error ? null : configFile.text, deps.input.configPath, (message) => {
    deps.io.warning(message)
  })
  const language = parseLanguage(deps.input.commentLanguage) ?? config.language

  const scope = config.checks.scope
    ? await collectScope(client, pr, context, config, prRepo)
    : skippedScope()
  const evidence = config.checks.testEvidence
    ? await collectEvidence(client, context.sha, pr.headSha, config)
    : skippedEvidence(context.sha)
  const packet = config.checks.reviewPacket
    ? analyzePacket(pr.body, config.reviewPacket)
    : skippedPacket()

  const report: Report = {
    language,
    failOn,
    headSha: context.sha,
    generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    scope,
    evidence,
    packet,
  }
  const body = renderComment(report, prRepo)
  let comments
  try {
    comments = await client.listComments(context.number)
  } catch (error) {
    throw commentFailure(context.number, error)
  }
  const sticky = findSticky(comments)
  if (sticky.length > 1) {
    deps.io.warning(`Found ${sticky.length} pr-evidence-check comments. Updating the oldest.`)
  }
  let posted: { id: number; url: string }
  try {
    const existing = sticky[0]
    posted = existing
      ? await client.updateComment(existing.id, body)
      : await client.createComment(context.number, body)
  } catch (error) {
    throw commentFailure(context.number, error)
  }

  deps.io.setOutput('scope-status', scope.status)
  deps.io.setOutput('test-evidence-status', evidence.status)
  deps.io.setOutput('review-packet-status', packet.status)
  deps.io.setOutput('comment-url', posted.url)
  deps.io.setOutput('head-sha', context.sha)
  await deps.io.writeSummary(renderSummary(report, prRepo))
  deps.io.info(`Updated PR evidence comment: ${posted.url}`)

  const failure = thresholdFailure(failOn, [
    { name: 'scope', status: scope.status },
    { name: 'test-evidence', status: evidence.status },
    { name: 'review-packet', status: packet.status },
  ])
  if (failure) throw new ActionFailure('threshold', failure)
  return { commentUrl: posted.url }
}

async function collectScope(
  client: GitHubClient,
  pr: { number: number; title: string; body: string; authorLogin: string; authorType: string; labels: string[] },
  context: { number: number },
  config: ReturnType<typeof loadConfig>,
  prRepo: string,
) {
  try {
    const files = await client.listFiles(pr.number)
    const linked = await client.listClosingIssues(context.number)
    const refs = extractClosingReferences(`${pr.title}\n${pr.body}`, prRepo, config.scope.closingKeywords)
    const known = new Set(linked.issues.map((issue) => issueKey(issue.repo, issue.number)))
    const fetched = new Map<string, LinkedIssue | null>()
    for (const ref of refs) {
      const key = issueKey(ref.repo, ref.number)
      if (known.has(key)) continue
      try {
        fetched.set(key, await client.getIssue(ref.repo, ref.number))
      } catch {
        fetched.set(key, null)
      }
    }
    const issues = mergeLinkedIssues(linked.issues, refs, fetched)
    const apiError = issues.length === 0 && linked.error ? linked.error : undefined
    return analyzeScope({
      prRepo,
      files,
      issues,
      config: config.scope,
      authorLogin: pr.authorLogin,
      authorType: pr.authorType,
      labels: pr.labels,
      ...(apiError ? { apiError } : {}),
    })
  } catch (error) {
    return analyzeScope({
      prRepo,
      files: [],
      issues: [],
      config: config.scope,
      apiError: errorMessage(error),
      filesUnavailable: true,
    })
  }
}

async function collectEvidence(
  client: GitHubClient,
  eventSha: string,
  apiSha: string,
  config: ReturnType<typeof loadConfig>,
) {
  try {
    const jobs = await client.listWorkflowJobs(eventSha)
    const checks = await client.listCheckRuns(eventSha)
    const selected = selectEvidence({ jobs, checks, config: config.testEvidence })
    const downloadable = selected.jobs.filter((job) => job.status === 'completed').slice(0, config.testEvidence.maxLogJobs)
    const downloadIds = new Set(downloadable.map((job) => job.id))
    const items: EvidenceItem[] = []
    for (const job of selected.jobs) {
      let text: string | null = null
      let logError: string | undefined
      if (job.status === 'completed' && config.testEvidence.parseLogs) {
        if (downloadIds.has(job.id)) {
          const log = await client.getJobLog(job.id, config.testEvidence.maxLogBytes)
          text = log.text
          logError = log.error
        } else {
          logError = 'log download cap reached'
        }
      }
      items.push({
        source: 'workflow_job',
        name: job.name,
        workflowName: job.workflowName,
        status: job.status,
        conclusion: job.conclusion,
        ...(job.htmlUrl ? { url: job.htmlUrl } : {}),
        ...(job.event ? { event: job.event } : {}),
        ...(job.completedAt ? { completedAt: job.completedAt } : {}),
        runId: job.runId,
        text,
        ...(logError ? { logError } : {}),
      })
    }
    for (const check of selected.checks) {
      items.push({
        source: 'check_run',
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        ...(check.htmlUrl ? { url: check.htmlUrl } : {}),
        text: check.summary ?? null,
      })
    }
    return buildEvidence({
      sha: eventSha,
      items,
      config: config.testEvidence,
      consideredJobs: jobs.length,
      consideredChecks: checks.length,
      ...(eventSha !== apiSha ? { shaMismatch: { eventSha, apiSha } } : {}),
    })
  } catch (error) {
    return buildEvidence({
      sha: eventSha,
      items: [],
      config: config.testEvidence,
      apiError: errorMessage(error),
      consideredJobs: 0,
      consideredChecks: 0,
      ...(eventSha !== apiSha ? { shaMismatch: { eventSha, apiSha } } : {}),
    })
  }
}

function commentFailure(number: number, error: unknown): ActionFailure {
  if (error instanceof GitHubHttpError && (error.status === 401 || error.status === 403 || error.status === 404)) {
    return new ActionFailure(
      'delivery',
      `Cannot comment on pull request #${number} (${error.status}). Grant pull-requests: write.`,
    )
  }
  return new ActionFailure('delivery', `Cannot comment on pull request #${number}: ${errorMessage(error)}`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
