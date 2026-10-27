import type { ParsedCounts } from '../types'

const PRIORITY = ['cargo', 'jest', 'vitest', 'pytest', 'go', 'junit'] as const

export function normalizeActionsLog(text: string): string {
  const plain = text
    .replace(/^\uFEFF/, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  return plain
    .split('\n')
    .map((line) => line
      .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, '')
      .replace(/^(?:##\[(?:group|endgroup|command)\]|::(?:group|endgroup)::)/, ''))
    .join('\n')
}

export function parseTestOutput(text: string): ParsedCounts | null {
  const clean = normalizeActionsLog(text)
  const parsers: Record<(typeof PRIORITY)[number], (input: string) => ParsedCounts | null> = {
    cargo: parseCargo,
    jest: parseJest,
    vitest: parseVitest,
    pytest: parsePytest,
    go: parseGo,
    junit: parseJunit,
  }
  for (const name of PRIORITY) {
    const parsed = parsers[name](clean)
    if (parsed) return parsed
  }
  return null
}

export function parseJest(text: string): ParsedCounts | null {
  const matches = [...text.matchAll(/Tests:\s+((?:\d+\s+(?:failed|passed|skipped|todo|total)(?:,\s*)?)+)/gi)]
  const last = matches[matches.length - 1]?.[1]
  if (!last) return null
  const counts = readNamedCounts(last)
  if (counts.total == null && counts.passed == null && counts.failed == null) return null
  const passed = counts.passed ?? 0
  const failed = counts.failed ?? 0
  const skipped = (counts.skipped ?? 0) + (counts.todo ?? 0)
  const total = counts.total ?? passed + failed + skipped
  return finish('jest', passed, failed, skipped, total, `jest: ${passed} passed, ${failed} failed, ${total} total`)
}

export function parseVitest(text: string): ParsedCounts | null {
  const matches = [...text.matchAll(/^[ \t]*Tests[ \t]+(?!Files\b)(.+)$/gim)]
  const last = matches[matches.length - 1]?.[1]
  if (!last || /:\s/.test(last)) return null
  const counts = readNamedCounts(last.replace(/[()]/g, ' '))
  if (counts.passed == null && counts.failed == null && counts.skipped == null) return null
  const passed = counts.passed ?? 0
  const failed = counts.failed ?? 0
  const skipped = (counts.skipped ?? 0) + (counts.todo ?? 0)
  const totalMatch = /\((\d+)\)\s*$/.exec(matches[matches.length - 1]?.[0] ?? '')
  const total = totalMatch?.[1] ? Number(totalMatch[1]) : passed + failed + skipped
  return finish('vitest', passed, failed, skipped, total, `vitest: ${passed} passed, ${failed} failed, ${total} total`)
}

export function parsePytest(text: string): ParsedCounts | null {
  const matches = [...text.matchAll(/={3,}\s*(.*?)\s+in\s+[\d.]+s(?:econds?)?\s*={3,}/gi)]
  const last = matches[matches.length - 1]?.[1]
  if (!last) return null
  if (/no tests ran/i.test(last)) {
    return finish('pytest', 0, 0, 0, 0, 'pytest: no tests ran')
  }
  const counts = readNamedCounts(last)
  if (counts.passed == null && counts.failed == null && counts.skipped == null && counts.error == null && counts.errors == null) {
    return null
  }
  const passed = counts.passed ?? 0
  const errors = (counts.error ?? 0) + (counts.errors ?? 0)
  const failed = (counts.failed ?? 0) + errors
  const skipped = counts.skipped ?? 0
  const total = passed + failed + skipped
  const errorNote = errors > 0 ? `, ${errors} errors` : ''
  return finish('pytest', passed, failed, skipped, total, `pytest: ${passed} passed, ${failed} failed, ${skipped} skipped${errorNote}`)
}

export function parseGo(text: string): ParsedCounts | null {
  const tests = [...text.matchAll(/^--- (PASS|FAIL|SKIP):\s+\S+/gm)]
  if (tests.length > 0) {
    let passed = 0
    let failed = 0
    let skipped = 0
    for (const match of tests) {
      if (match[1] === 'PASS') passed += 1
      else if (match[1] === 'FAIL') failed += 1
      else skipped += 1
    }
    const total = passed + failed + skipped
    return finish('go', passed, failed, skipped, total, `go test: ${passed} passed, ${failed} failed, ${skipped} skipped`)
  }
  const packages = [...text.matchAll(/^(ok|FAIL)[ \t]+\S+/gm)]
  if (packages.length === 0) return null
  let passed = 0
  let failed = 0
  for (const match of packages) {
    if (match[1] === 'ok') passed += 1
    else failed += 1
  }
  const total = passed + failed
  return finish('go', passed, failed, 0, total, `go test packages: ${passed} ok, ${failed} failed (no per-test lines)`)
}

export function parseCargo(text: string): ParsedCounts | null {
  const matches = [...text.matchAll(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/gi)]
  if (matches.length === 0) return null
  let passed = 0
  let failed = 0
  let skipped = 0
  for (const match of matches) {
    passed += Number(match[1] ?? 0)
    failed += Number(match[2] ?? 0)
    skipped += Number(match[3] ?? 0)
  }
  const total = passed + failed + skipped
  return finish(
    'cargo',
    passed,
    failed,
    skipped,
    total,
    `cargo test: ${passed} passed, ${failed} failed, ${skipped} ignored across ${matches.length} target${matches.length === 1 ? '' : 's'}`,
  )
}

export function parseJunit(text: string): ParsedCounts | null {
  const xml = parseJunitXml(text)
  if (xml) return xml
  const matches = [...text.matchAll(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)(?:,\s*Skipped:\s*(\d+))?/gi)]
  const last = matches[matches.length - 1]
  if (!last) return null
  const total = Number(last[1] ?? 0)
  const failures = Number(last[2] ?? 0)
  const errors = Number(last[3] ?? 0)
  const skipped = Number(last[4] ?? 0)
  const failed = failures + errors
  const passed = Math.max(0, total - failed - skipped)
  return finish('junit', passed, failed, skipped, total, `junit: ${passed} passed, ${failed} failed, ${skipped} skipped, ${total} total`)
}

function parseJunitXml(text: string): ParsedCounts | null {
  const suites = [...text.matchAll(/<testsuites\b([^>]*)>/gi)]
    .map((match) => readXmlCounts(match[1] ?? ''))
    .filter((counts): counts is XmlCounts => counts != null)
  if (suites.length > 0) {
    const best = suites.sort((a, b) => b.tests - a.tests)[0]
    if (best) return xmlResult(best)
  }
  const cases = [...text.matchAll(/<testsuite\b([^>]*)>/gi)]
    .map((match) => readXmlCounts(match[1] ?? ''))
    .filter((counts): counts is XmlCounts => counts != null)
  if (cases.length === 0) return null
  const sum = cases.reduce(
    (acc, item) => ({
      tests: acc.tests + item.tests,
      failures: acc.failures + item.failures,
      errors: acc.errors + item.errors,
      skipped: acc.skipped + item.skipped,
    }),
    { tests: 0, failures: 0, errors: 0, skipped: 0 },
  )
  return xmlResult(sum)
}

interface XmlCounts {
  tests: number
  failures: number
  errors: number
  skipped: number
}

function readXmlCounts(attrs: string): XmlCounts | null {
  const tests = /(?:^|\s)tests="(\d+)"/i.exec(attrs)?.[1]
  if (!tests) return null
  const failures = Number(/(?:^|\s)failures="(\d+)"/i.exec(attrs)?.[1] ?? 0)
  const errors = Number(/(?:^|\s)errors="(\d+)"/i.exec(attrs)?.[1] ?? 0)
  const skipped = Number(/(?:^|\s)skipped="(\d+)"/i.exec(attrs)?.[1] ?? 0) + Number(/(?:^|\s)disabled="(\d+)"/i.exec(attrs)?.[1] ?? 0)
  return { tests: Number(tests), failures, errors, skipped }
}

function xmlResult(counts: XmlCounts): ParsedCounts {
  const failed = counts.failures + counts.errors
  const passed = Math.max(0, counts.tests - failed - counts.skipped)
  return finish(
    'junit',
    passed,
    failed,
    counts.skipped,
    counts.tests,
    `junit: ${passed} passed, ${failed} failed, ${counts.skipped} skipped, ${counts.tests} total`,
  )
}

function readNamedCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const match of text.matchAll(/(\d+)\s+([A-Za-z]+)/g)) {
    const name = (match[2] ?? '').toLowerCase()
    const value = Number(match[1] ?? 0)
    if (!name) continue
    counts[name] = value
  }
  return counts
}

function finish(
  framework: ParsedCounts['framework'],
  passed: number,
  failed: number,
  skipped: number,
  total: number,
  detail: string,
): ParsedCounts {
  return { framework, passed, failed, skipped, total, detail }
}
