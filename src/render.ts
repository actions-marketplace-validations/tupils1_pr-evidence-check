import { sensitiveReasonLabel } from './config'
import { cell, inlineText, issueLabel, shortSha } from './text'
import type {
  EvidenceJobReport,
  EvidenceReport,
  EvidenceSignal,
  FileExplanation,
  FileVerdict,
  Language,
  PacketReport,
  PacketSection,
  Report,
  ScopeFileReport,
  ScopeReport,
  ScopeSignal,
  SensitiveReason,
} from './types'

export const MARKER = '<!-- pr-evidence-check -->'
const FILE_LIMIT = 40

export function renderComment(report: Report, prRepo: string): string {
  const statusLine = `<!-- pr-evidence-check scope=${report.scope.status} test-evidence=${report.evidence.status} review-packet=${report.packet.status} -->`
  const body = renderBody(report, prRepo)
  return `${MARKER}\n${statusLine}\n${body}`
}

export function renderSummary(report: Report, prRepo: string): string {
  return renderBody(report, prRepo)
}

function renderBody(report: Report, prRepo: string): string {
  const lang = report.language
  const parts = [
    heading(lang),
    intro(report, lang),
    '',
    statusTable(report, lang),
    '',
    renderScope(report.scope, lang, prRepo),
    '',
    renderEvidence(report.evidence, lang),
    '',
    renderPacket(report.packet, lang),
    '',
    footer(report, lang),
  ]
  return parts.join('\n')
}

function heading(lang: Language): string {
  return lang === 'zh' ? '## PR 证据' : '## PR evidence'
}

function intro(report: Report, lang: Language): string {
  if (lang === 'zh') {
    return [
      '这是一条确定性的审查评论，只供维护者扫读。没有调用 LLM，也没有重新跑测试。',
      `下面的测试证据只来自 head SHA \`${shortSha(report.headSha)}\` 上**已经存在**的 check run 和 Actions job。`,
      `默认不阻断合并（\`fail-on: ${report.failOn}\`）。`,
    ].join('')
  }
  return [
    'Deterministic review notes for maintainers. No LLM was called, and tests were not re-run.',
    ` Test evidence is whatever CI already recorded for head SHA \`${shortSha(report.headSha)}\`.`,
    ` This does not block merges (\`fail-on: ${report.failOn}\`).`,
  ].join('')
}

function statusTable(report: Report, lang: Language): string {
  const headers = lang === 'zh' ? ['检查', '结果'] : ['Check', 'Result']
  const rows = [
    [lang === 'zh' ? '范围与关联 issue' : 'Scope vs linked issue', statusWord(report.scope.status, lang)],
    [lang === 'zh' ? '测试证据（已有 CI）' : 'Test evidence (existing CI)', statusWord(report.evidence.status, lang)],
    [lang === 'zh' ? '审查材料包' : 'Review packet', statusWord(report.packet.status, lang)],
  ]
  return markdownTable(headers, rows.map((row) => row.map((value) => `**${value}**`)))
}

function renderScope(scope: ScopeReport, lang: Language, prRepo: string): string {
  const title = lang === 'zh' ? '### 范围与关联 issue' : '### Scope vs linked issue'
  if (!scope.enabled) {
    return `${title} · ${statusWord('skipped', lang)}\n\n${lang === 'zh' ? '已在配置中关闭。' : 'Disabled in config.'}`
  }
  const lines: string[] = [`${title} · ${statusWord(scope.status, lang)}`, '']
  if (scope.issues.length === 0) {
    lines.push(lang === 'zh'
      ? '没有找到关联 issue。标题或正文里的 closing keyword（`Fixes #123`）以及 GitHub 的 linked issues 都会被识别。没有 issue 时，不能判断文件是否超出任务范围。'
      : 'No linked issue. Closing keywords in the title or body (`Fixes #123`) and GitHub linked issues are both read. Without an issue, files cannot be judged in or out of scope.')
  } else {
    const links = scope.issues.map((issue) => {
      const label = issueLabel(prRepo, issue.repo, issue.number)
      const titleText = issue.title ? ` “${inlineText(issue.title, 80)}”` : ''
      return `[${label}](${issue.url})${titleText}`
    })
    lines.push(lang === 'zh'
      ? `对照了 ${scope.fileCount} 个文件（+${scope.additions} / −${scope.deletions}）与 ${links.join('、')}。`
      : `Compared ${scope.fileCount} files (+${scope.additions} / −${scope.deletions}) with ${links.join(', ')}.`)
  }
  if (scope.signals.length > 0) {
    lines.push('', lang === 'zh' ? '**信号**' : '**Signals**', '')
    for (const signal of scope.signals) lines.push(`- ${renderScopeSignal(signal, lang)}`)
  }
  if (scope.files.length > 0) {
    const sorted = sortFiles(scope.files)
    const shown = sorted.slice(0, FILE_LIMIT)
    lines.push('', lang === 'zh' ? '**文件**' : '**Files**', '')
    if (sorted.length > shown.length) {
      lines.push(lang === 'zh'
        ? `只列出 ${shown.length} / ${sorted.length} 个文件。超出范围和敏感路径排在前面。`
        : `Showing ${shown.length} of ${sorted.length} files. Outside-scope and sensitive paths come first.`)
      lines.push('')
    }
    const headers = lang === 'zh' ? ['文件', '+/−', '结论', '原因'] : ['File', '+/−', 'Verdict', 'Why']
    const rows = shown.map((file) => [
      `\`${cell(file.filename)}\``,
      `+${file.additions}/−${file.deletions}`,
      verdictLabel(file, lang),
      explainFile(file, lang, prRepo),
    ])
    lines.push(markdownTable(headers, rows))
  }
  return lines.join('\n')
}

function renderEvidence(evidence: EvidenceReport, lang: Language): string {
  const title = lang === 'zh' ? '### 测试证据（已有 CI）' : '### Test evidence (existing CI)'
  if (!evidence.enabled) {
    return `${title} · ${statusWord('skipped', lang)}\n\n${lang === 'zh' ? '已在配置中关闭。' : 'Disabled in config.'}`
  }
  const lines: string[] = [`${title} · ${statusWord(evidence.status, lang)}`, '']
  lines.push(lang === 'zh'
    ? `只读取 SHA \`${evidence.sha}\` 上已经存在的 workflow job（${evidence.consideredJobs}）和 check run（${evidence.consideredChecks}）。本 action 没有启动测试。`
    : `Read existing workflow jobs (${evidence.consideredJobs}) and check runs (${evidence.consideredChecks}) for \`${evidence.sha}\`. This action did not start a test run.`)
  if (evidence.signals.length > 0) {
    lines.push('', lang === 'zh' ? '**信号**' : '**Signals**', '')
    for (const signal of evidence.signals) lines.push(`- ${renderEvidenceSignal(signal, lang)}`)
  }
  if (evidence.jobs.length > 0) {
    lines.push('', lang === 'zh' ? '**命中的 job**' : '**Matched jobs**', '')
    const headers = lang === 'zh' ? ['Job', '结果', '计数'] : ['Job', 'Result', 'Counts']
    const rows = evidence.jobs.map((job) => [
      jobLink(job),
      job.conclusion ?? job.status,
      countsCell(job, lang),
    ])
    lines.push(markdownTable(headers, rows))
  }
  return lines.join('\n')
}

function renderPacket(packet: PacketReport, lang: Language): string {
  const title = lang === 'zh' ? '### 审查材料包' : '### Review packet'
  if (!packet.enabled) {
    return `${title} · ${statusWord('skipped', lang)}\n\n${lang === 'zh' ? '已在配置中关闭。' : 'Disabled in config.'}`
  }
  const lines: string[] = [`${title} · ${statusWord(packet.status, lang)}`, '']
  lines.push(lang === 'zh'
    ? '在 PR 描述里查找 Intent / 意图、Risks / 风险、Tests run / 已运行测试、Self-verification / 本人验证。英文或中文标题都能命中。HTML 注释和 `TODO` 这类占位不算正文。'
    : 'Looks in the pull request body for Intent, Risks, Tests run, and Self-verification. English or Chinese headings both count. HTML comments and placeholders such as `TODO` do not.')
  lines.push('')
  const headers = lang === 'zh' ? ['小节', '结果', '说明'] : ['Section', 'Result', 'Detail']
  const rows = packet.sections.map((section) => [
    sectionName(section.id, lang),
    packetStatus(section.status, lang),
    packetDetail(section, lang),
  ])
  lines.push(markdownTable(headers, rows))
  return lines.join('\n')
}

function footer(report: Report, lang: Language): string {
  const stamp = report.generatedAt
  if (lang === 'zh') {
    return `---\n\n<sub>pr-evidence-check · 只发评论 · 同一条评论原地更新 · SHA \`${report.headSha}\` · ${stamp}</sub>`
  }
  return `---\n\n<sub>pr-evidence-check · comment only · sticky comment updated in place · SHA \`${report.headSha}\` · ${stamp}</sub>`
}

export function sortFiles(files: readonly ScopeFileReport[]): ScopeFileReport[] {
  return [...files].sort((a, b) => bucket(a) - bucket(b) || a.filename.localeCompare(b.filename))
}

function bucket(file: ScopeFileReport): number {
  const hot = file.sensitive.some((hit) => !hit.mentioned)
  if (file.verdict === 'outside_scope' && hot) return 0
  if (file.verdict === 'outside_scope') return 1
  if (file.verdict === 'not_compared' && hot) return 2
  if (file.verdict === 'not_compared') return 3
  if (hot) return 4
  if (file.sensitive.length > 0) return 5
  if (file.verdict === 'in_scope') return 6
  return 7
}

function explainFile(file: ScopeFileReport, lang: Language, prRepo: string): string {
  return file.explanations.map((item) => explainOne(item, lang, prRepo)).join(' ')
}

function explainOne(item: FileExplanation, lang: Language, prRepo: string): string {
  switch (item.code) {
    case 'scope.in_scope.path_mention': {
      const ref = issueLabel(prRepo, item.repo, item.issueNumber)
      const via = item.viaPrevious
        ? (lang === 'zh' ? `（匹配的是改名前的 \`${cell(item.viaPrevious)}\`）` : ` (matched the previous path \`${cell(item.viaPrevious)}\`)`)
        : ''
      return lang === 'zh'
        ? `\`${item.code}\` — 对 ${ref} 在范围内：issue 文本写到了 \`${cell(item.quoted)}\`${via}。`
        : `\`${item.code}\` — In scope for ${ref}: the issue text mentions \`${cell(item.quoted)}\`${via}.`
    }
    case 'scope.in_scope.path_tokens': {
      const ref = issueLabel(prRepo, item.repo, item.issueNumber)
      const via = item.viaPrevious
        ? (lang === 'zh' ? `匹配的是改名前的 \`${cell(item.viaPrevious)}\`。` : `Matched the previous path \`${cell(item.viaPrevious)}\`. `)
        : ''
      return lang === 'zh'
        ? `\`${item.code}\` — 对 ${ref} 在范围内：路径词 ${codeList(item.tokens)} 出现在关联 issue 中（“${cell(item.snippet)}”）。${via}`
        : `\`${item.code}\` — In scope for ${ref}: path tokens ${codeList(item.tokens)} appear in the linked issue (“${cell(item.snippet)}”). ${via}`.trim()
    }
    case 'scope.in_scope.diff_keywords': {
      const ref = issueLabel(prRepo, item.repo, item.issueNumber)
      return lang === 'zh'
        ? `\`${item.code}\` — 对 ${ref} 仅因 diff 里的标识符 ${codeList(item.tokens)} 与 issue 重合而算在范围内，路径本身没有对上。这是较弱的信号。`
        : `\`${item.code}\` — In scope for ${ref} only because diff identifiers ${codeList(item.tokens)} also appear in the issue, not because of the file path. This is a weaker signal.`
    }
    case 'scope.outside': {
      const tokenText = item.fileTokens.length > 0
        ? codeList(item.fileTokens)
        : (lang === 'zh' ? '（去掉 `src/`、`test/`、`index` 这类泛目录后没有具体词）' : '(none after dropping generic directories such as `src/`, `test/`, and `index`)')
      const issues = item.issueRefs.join(', ') || (lang === 'zh' ? '关联 issue' : 'the linked issues')
      const keywords = item.issueKeywords.length > 0 ? codeList(item.issueKeywords) : (lang === 'zh' ? '（无）' : '(none)')
      return lang === 'zh'
        ? `\`${item.code}\` — 超出 ${issues} 的范围。文件词：${tokenText}。issue 关键词：${keywords}。没有共同关键词。`
        : `\`${item.code}\` — Outside ${issues}. File tokens: ${tokenText}. Issue keywords: ${keywords}. No shared keyword.`
    }
    case 'scope.no_linked_issue':
      return lang === 'zh'
        ? '`scope.no_linked_issue` — 未对照：没有关联 issue，所以没有判断这个文件是否超出任务。'
        : '`scope.no_linked_issue` — Not compared: there is no linked issue, so this file was not judged against a task.'
    case 'scope.ignored':
      return lang === 'zh'
        ? `\`scope.ignored\` — 命中忽略模式 \`${cell(item.pattern)}\`，不做范围判断。`
        : `\`scope.ignored\` — Ignored by pattern \`${cell(item.pattern)}\`; scope was not judged.`
    case 'scope.sensitive':
      return explainSensitive(item, lang)
    case 'scope.renamed_from':
      return lang === 'zh'
        ? `\`scope.renamed_from\` — 从 \`${cell(item.previous)}\` 改名而来。`
        : `\`scope.renamed_from\` — Renamed from \`${cell(item.previous)}\`.`
    default:
      return ''
  }
}

function explainSensitive(
  item: Extract<FileExplanation, { code: 'scope.sensitive' }>,
  lang: Language,
): string {
  const reason = sensitiveReasonLabel(item.reason, lang)
  if (item.mentioned) {
    return lang === 'zh'
      ? `\`scope.sensitive_mentioned\` — 敏感路径（${reason}，模式 \`${cell(item.pattern)}\`）。关联 issue 写到了 \`${cell(item.mention ?? '')}\`，看起来是有意改动。`
      : `\`scope.sensitive_mentioned\` — Sensitive path (${reason}, pattern \`${cell(item.pattern)}\`). A linked issue mentions \`${cell(item.mention ?? '')}\`, so this looks intentional.`
  }
  return lang === 'zh'
    ? `\`scope.sensitive\` — 敏感路径（${reason}，模式 \`${cell(item.pattern)}\`）。关联 issue 没有提到这个路径。`
    : `\`scope.sensitive\` — Sensitive path (${reason}, pattern \`${cell(item.pattern)}\`). No linked issue mentions this path.`
}

function quietNoIssueNote(
  signal: Extract<ScopeSignal, { id: 'scope.no_linked_issue' }>,
  lang: Language,
): string {
  if (signal.level !== 'info' || !signal.quiet) return ''
  const detail = cell(signal.quietDetail ?? '')
  if (lang === 'zh') {
    switch (signal.quiet) {
      case 'bot':
        return `因为作者是机器人（\`${detail}\`），所以这条记为 info，不计入警告。`
      case 'docs':
        return '因为改动的文件全是文档，所以这条记为 info，不计入警告。'
      case 'ignored':
        return '因为改动的文件都命中了 `ignore-paths`，所以这条记为 info，不计入警告。'
      case 'docs_or_ignored':
        return '因为改动的文件要么是文档，要么命中了 `ignore-paths`，所以这条记为 info，不计入警告。'
      case 'label':
        return `因为 PR 带有跳过标签 \`${detail}\`，所以这条记为 info，不计入警告。`
      case 'config':
        return '因为配置 `scope.no-linked-issue` 是 `info`，所以这条记为 info，不计入警告。'
      default:
        return ''
    }
  }
  switch (signal.quiet) {
    case 'bot':
      return `Recorded as info, not a warning, because the author is a bot (\`${detail}\`).`
    case 'docs':
      return 'Recorded as info, not a warning, because every changed file is documentation.'
    case 'ignored':
      return 'Recorded as info, not a warning, because every changed file matches `ignore-paths`.'
    case 'docs_or_ignored':
      return 'Recorded as info, not a warning, because every changed file is documentation or matches `ignore-paths`.'
    case 'label':
      return `Recorded as info, not a warning, because the pull request has the skip label \`${detail}\`.`
    case 'config':
      return 'Recorded as info, not a warning, because `scope.no-linked-issue` is `info`.'
    default:
      return ''
  }
}

function renderScopeSignal(signal: ScopeSignal, lang: Language): string {
  switch (signal.id) {
    case 'scope.no_files':
      return lang === 'zh' ? '`scope.no_files` — 这个 PR 没有改文件。' : '`scope.no_files` — This pull request changes no files.'
    case 'scope.no_linked_issue': {
      const base = lang === 'zh'
        ? '`scope.no_linked_issue` — 没有关联 issue，范围检查只能标出敏感路径和大 diff。'
        : '`scope.no_linked_issue` — No linked issue. Scope can still flag sensitive paths and a large diff, but not unrelated files.'
      const note = quietNoIssueNote(signal, lang)
      return note ? `${base} ${note}` : base
    }
    case 'scope.issue_unreadable':
      return lang === 'zh'
        ? `\`scope.issue_unreadable\` — 关联的 ${signal.issues.join(', ')} 正文读不到，范围判断可能偏严。`
        : `\`scope.issue_unreadable\` — Could not read ${signal.issues.join(', ')}. Scope comparison may mark files outside because the issue text is empty.`
    case 'scope.large_diff': {
      const bits = [
        signal.overLines
          ? (lang === 'zh'
            ? `${signal.additions + signal.deletions} 行达到阈值 ${signal.lineThreshold}`
            : `${signal.additions + signal.deletions} lines reach the threshold of ${signal.lineThreshold}`)
          : '',
        signal.overFiles
          ? (lang === 'zh' ? `${signal.files} 个文件达到阈值 ${signal.fileThreshold}` : `${signal.files} files reach the threshold of ${signal.fileThreshold}`)
          : '',
      ].filter(Boolean)
      return lang === 'zh'
        ? `\`scope.large_diff\` — diff 偏大（+${signal.additions} / −${signal.deletions}，${signal.files} 个文件；${bits.join('，')}）。大 PR 更难审，也更容易夹带无关改动。`
        : `\`scope.large_diff\` — Large diff (+${signal.additions} / −${signal.deletions} across ${signal.files} files; ${bits.join('; ')}). Large pull requests are harder to review and more often mix unrelated work.`
    }
    case 'scope.large_unrelated_file':
      return lang === 'zh'
        ? `\`scope.large_unrelated_file\` — \`${cell(signal.filename)}\` 改了 ${signal.lines} 行（阈值 ${signal.threshold}），并且和关联 issue 对不上。`
        : `\`scope.large_unrelated_file\` — \`${cell(signal.filename)}\` changes ${signal.lines} lines (threshold ${signal.threshold}) and does not match the linked issue.`
    case 'scope.outside_cluster':
      return lang === 'zh'
        ? `\`scope.outside_cluster\` — \`${cell(signal.directory)}/\` 下有 ${signal.files.length} 个文件和 ${signal.issueRefs.join(', ') || '关联 issue'} 没有共同关键词：${codeList(signal.files, 6)}。issue 关键词：${codeList(signal.issueKeywords)}。`
        : `\`scope.outside_cluster\` — ${signal.files.length} files under \`${cell(signal.directory)}/\` share no keyword with ${signal.issueRefs.join(', ') || 'the linked issues'}: ${codeList(signal.files, 6)}. Issue keywords: ${codeList(signal.issueKeywords)}.`
    case 'scope.outside_ratio':
      return lang === 'zh'
        ? `\`scope.outside_ratio\` — ${signal.judged} 个被判断的文件里有 ${signal.outside} 个超出范围（${Math.round(signal.ratio * 100)}%，阈值 ${Math.round(signal.threshold * 100)}%，且至少 ${signal.minFiles} 个）。`
        : `\`scope.outside_ratio\` — ${signal.outside} of ${signal.judged} judged files are outside scope (${Math.round(signal.ratio * 100)}%, threshold ${Math.round(signal.threshold * 100)}% and at least ${signal.minFiles} files).`
    case 'scope.sensitive':
      return lang === 'zh'
        ? `\`scope.sensitive\` — 这些敏感路径没有出现在关联 issue 里：${signal.files.map((file) => `\`${cell(file.filename)}\`（${sensitiveReasonLabel(file.reason, lang)}）`).join('、')}。`
        : `\`scope.sensitive\` — Sensitive paths not mentioned by a linked issue: ${signal.files.map((file) => `\`${cell(file.filename)}\` (${sensitiveReasonLabel(file.reason, lang)})`).join(', ')}.`
    case 'scope.api_error':
      return lang === 'zh'
        ? `\`scope.api_error\` — 读取 PR 文件或关联 issue 失败：${cell(signal.message)}`
        : `\`scope.api_error\` — Could not read pull request files or linked issues: ${cell(signal.message)}`
    case 'scope.sha_note':
      return `\`${signal.id}\` — ${cell(signal.message)}`
    default:
      return ''
  }
}

function renderEvidenceSignal(signal: EvidenceSignal, lang: Language): string {
  switch (signal.id) {
    case 'test_evidence.not_rerun':
      return lang === 'zh'
        ? '`test_evidence.not_rerun` — 只读取已有 CI，不重新执行测试命令。'
        : '`test_evidence.not_rerun` — Existing CI results only. No test command was executed.'
    case 'test_evidence.none':
      return lang === 'zh'
        ? '`test_evidence.none` — 这个 SHA 上没有名称像测试的 job 或 check run。若测试 job 不叫 test / jest / pytest 等，可在配置里加 `job-name-patterns`。'
        : '`test_evidence.none` — No test-like job or check run on this SHA. Add `job-name-patterns` if your test job uses another name.'
    case 'test_evidence.in_progress':
      return lang === 'zh'
        ? `\`test_evidence.in_progress\` — 还有 ${signal.count} 个测试 job 没跑完。把本 action 放在测试 job 之后并加上 \`if: always()\`，或者等 CI 结束后重跑。`
        : `\`test_evidence.in_progress\` — ${signal.count} test ${signal.count === 1 ? 'job is' : 'jobs are'} still running. Put this action after the test job with \`if: always()\`, or re-run it when CI finishes.`
    case 'test_evidence.failed':
      return lang === 'zh'
        ? `\`test_evidence.failed\` — 这些测试 job 没有成功：${signal.jobs.map((job) => `\`${cell(job)}\``).join('、')}。`
        : `\`test_evidence.failed\` — Test jobs that did not succeed: ${signal.jobs.map((job) => `\`${cell(job)}\``).join(', ')}.`
    case 'test_evidence.skipped_only':
      return lang === 'zh'
        ? '`test_evidence.skipped_only` — 命中的测试 job 全部是 skipped，不能当作测试跑过。'
        : '`test_evidence.skipped_only` — Every matched test job was skipped, so this is not evidence that tests ran.'
    case 'test_evidence.passed':
      return lang === 'zh'
        ? `\`test_evidence.passed\` — ${signal.jobs} 个测试 job 已成功结束。`
        : `\`test_evidence.passed\` — ${signal.jobs} test ${signal.jobs === 1 ? 'job' : 'jobs'} completed successfully.`
    case 'test_evidence.logs_unreadable':
      return lang === 'zh'
        ? `\`test_evidence.logs_unreadable\` — 这些 job 的日志读不到，只有结论：${signal.jobs.map((job) => `\`${cell(job)}\``).join('、')}。`
        : `\`test_evidence.logs_unreadable\` — Logs were not readable; only the conclusion is shown for ${signal.jobs.map((job) => `\`${cell(job)}\``).join(', ')}.`
    case 'test_evidence.no_summary':
      return lang === 'zh'
        ? `\`test_evidence.no_summary\` — 日志里没有识别到 jest、vitest、pytest、go test、cargo test 或 junit 汇总：${signal.jobs.map((job) => `\`${cell(job)}\``).join('、')}。job 本身仍然说明测试跑过。`
        : `\`test_evidence.no_summary\` — No jest, vitest, pytest, go test, cargo test, or junit summary in ${signal.jobs.map((job) => `\`${cell(job)}\``).join(', ')}. The job still counts as evidence that a test task ran.`
    case 'test_evidence.zero_tests':
      return lang === 'zh'
        ? `\`test_evidence.zero_tests\` — 汇总显示 0 个测试：${signal.jobs.map((job) => `\`${cell(job)}\``).join('、')}。`
        : `\`test_evidence.zero_tests\` — The parsed summary reported zero tests for ${signal.jobs.map((job) => `\`${cell(job)}\``).join(', ')}.`
    case 'test_evidence.api_error':
      return lang === 'zh'
        ? `\`test_evidence.api_error\` — 读取 check 或 workflow 失败：${cell(signal.message)}`
        : `\`test_evidence.api_error\` — Could not read checks or workflow runs: ${cell(signal.message)}`
    case 'test_evidence.sha_mismatch':
      return lang === 'zh'
        ? `\`test_evidence.sha_mismatch\` — 事件 SHA \`${shortSha(signal.eventSha)}\` 和 PR 当前 head \`${shortSha(signal.apiSha)}\` 不一致。测试结果按事件 SHA 读取。`
        : `\`test_evidence.sha_mismatch\` — Event SHA \`${shortSha(signal.eventSha)}\` differs from the pull request head \`${shortSha(signal.apiSha)}\`. Test results were read for the event SHA.`
    default:
      return ''
  }
}

function countsCell(job: EvidenceJobReport, lang: Language): string {
  const detail = job.counts?.detail ?? ''
  switch (job.note) {
    case 'in_progress':
      return lang === 'zh' ? '仍在运行，未读日志' : 'still running; logs not read'
    case 'not_downloaded':
      return lang === 'zh' ? '已关闭日志解析' : 'log parsing disabled'
    case 'logs_unreadable':
      return cell(job.logError ?? (lang === 'zh' ? '日志不可读' : 'logs not readable'))
    case 'no_summary':
      return lang === 'zh' ? '已跑完；日志里没有识别到测试汇总' : 'finished; no recognized test summary in the log'
    case 'zero_tests':
      return cell(detail)
    default:
      return detail ? cell(detail) : (lang === 'zh' ? '无计数' : 'no counts')
  }
}

function jobLink(job: EvidenceJobReport): string {
  const name = job.workflowName ? `${job.workflowName} / ${job.name}` : job.name
  const safe = cell(name)
  return job.url ? `[${safe}](${job.url})` : `\`${safe}\``
}

function packetDetail(section: PacketSection, lang: Language): string {
  if (section.status === 'missing') {
    return lang === 'zh'
      ? `缺少 ${sectionName(section.id, lang)}。加上对应的英文或中文标题，并写上具体内容。`
      : `Missing ${sectionName(section.id, lang)}. Add the English or Chinese heading and a concrete note.`
  }
  if (section.status === 'placeholder') {
    return lang === 'zh'
      ? `标题“${cell(section.heading ?? '')}”下面只有占位文字。`
      : `Heading “${cell(section.heading ?? '')}” contains only a placeholder.`
  }
  if (section.status === 'empty') {
    return lang === 'zh'
      ? `标题“${cell(section.heading ?? '')}”下面的正文太短（${section.chars} 字符）。`
      : `Heading “${cell(section.heading ?? '')}” is present but the body is too short (${section.chars} characters).`
  }
  return lang === 'zh'
    ? `“${cell(section.heading ?? '')}”下有 ${section.chars} 字符。`
    : `${section.chars} characters under “${cell(section.heading ?? '')}”.`
}

function sectionName(id: PacketSection['id'], lang: Language): string {
  const en = { intent: 'Intent', risks: 'Risks', testsRun: 'Tests run', selfVerification: 'Self-verification' }
  const zh = { intent: '意图', risks: '风险', testsRun: '已运行测试', selfVerification: '本人验证' }
  return lang === 'zh' ? zh[id] : en[id]
}

function packetStatus(status: PacketSection['status'], lang: Language): string {
  const en = { present: 'present', missing: 'missing', empty: 'empty', placeholder: 'placeholder' }
  const zh = { present: '已填写', missing: '缺失', empty: '过短', placeholder: '占位' }
  return lang === 'zh' ? zh[status] : en[status]
}

function verdictLabel(file: ScopeFileReport, lang: Language): string {
  const names: Record<FileVerdict, [string, string]> = {
    in_scope: ['In scope', '在范围内'],
    outside_scope: ['Outside scope', '超出范围'],
    not_compared: ['Not compared', '未对照'],
    ignored: ['Ignored', '已忽略'],
  }
  const pair = names[file.verdict]
  const base = lang === 'zh' ? pair[1] : pair[0]
  if (file.sensitive.length === 0) return base
  return lang === 'zh' ? `${base} · 敏感路径` : `${base} · sensitive`
}

function statusWord(status: Report['scope']['status'], lang: Language): string {
  const en = { pass: 'pass', warn: 'warn', error: 'error', skipped: 'skipped' }
  const zh = { pass: '通过', warn: '警告', error: '错误', skipped: '已跳过' }
  return lang === 'zh' ? zh[status] : en[status]
}

function codeList(values: readonly string[], limit = 8): string {
  if (values.length === 0) return ''
  const shown = values.slice(0, limit).map((value) => `\`${cell(value)}\``)
  if (values.length <= limit) return shown.join(', ')
  return `${shown.join(', ')} +${values.length - limit}`
}

function markdownTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.map((value) => value.replace(/\n/g, ' ')).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

export function reasonText(reason: SensitiveReason, lang: Language): string {
  return sensitiveReasonLabel(reason, lang)
}
