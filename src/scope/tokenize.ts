import { hasBounded, snippetAround } from '../text'

/** Path segments that match too many issues to count as scope evidence. */
const PATH_GENERIC = new Set([
  'src', 'lib', 'app', 'apps', 'pkg', 'pkgs', 'dist', 'build', 'out', 'bin', 'obj',
  'node_modules', 'vendor', 'internal', 'cmd', 'scripts', 'script', 'test', 'tests',
  'spec', 'specs', '__tests__', 'testing', 'fixtures', 'fixture', 'testdata', 'e2e',
  'integration', 'unit', 'index', 'main', 'mod', 'public', 'static', 'assets', 'asset',
  'components', 'component', 'utils', 'util', 'helpers', 'helper', 'common', 'shared',
  'base', 'core', 'packages', 'package', 'services', 'service', 'api', 'apis',
  'v1', 'v2', 'v3', 'v4', 'html', 'css', 'scss', 'less', 'json', 'yml', 'yaml', 'toml',
  'md', 'txt', 'lock', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'rb',
  'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift', 'lua', 'sh', 'bash',
  'github', 'workflows', 'workflow', 'actions', 'docs', 'doc', 'examples', 'example',
  'client', 'server', 'data', 'view', 'views', 'page', 'pages', 'route', 'routes',
  'hook', 'hooks', 'model', 'models', 'controller', 'controllers', 'handler', 'handlers',
  'middleware', 'styles', 'style', 'types', 'type', 'interfaces', 'interface',
  'constants', 'constant', 'config', 'configs', 'configuration', 'web', 'www', 'env',
  'file', 'files',
])

const ISSUE_STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'onto', 'about', 'your',
  'you', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'not', 'but',
  'can', 'could', 'should', 'would', 'will', 'just', 'than', 'then', 'them', 'they',
  'their', 'there', 'here', 'when', 'where', 'what', 'which', 'who', 'why', 'how',
  'all', 'any', 'some', 'more', 'most', 'also', 'over', 'under', 'after', 'before',
  'because', 'while', 'does', 'did', 'done', 'fix', 'fixes', 'fixed', 'bug', 'bugs',
  'issue', 'issues', 'add', 'adds', 'added', 'update', 'updated', 'change', 'changes',
  'changed', 'make', 'makes', 'using', 'use', 'used', 'please', 'need', 'needs',
  'needed', 'file', 'files', 'code', 'must', 'dont', 'its', 'our', 'out', 'via',
  'per', 'etc', 'todo', 'tbd', 'none', 'null', 'true', 'false', 'error', 'errors',
  'fail', 'failed', 'failure', 'test', 'tests', 'testing', 'run', 'running', 'new',
  'old', 'get', 'set', 'let', 'var', 'const', 'function', 'return', 'import', 'export',
  'class', 'type', 'data', 'value', 'values', 'item', 'items', 'name', 'names',
  'user', 'users', 'request', 'response', 'result', 'results', 'status', 'message',
  'config', 'default', 'only', 'other', 'another', 'same', 'such', 'able', 'like',
  'want', 'work', 'working', 'broken', 'break', 'problem', 'problems', 'feature',
  'support', 'thanks', 'thank', 'hello', 'yes', 'nope', 'undefined', 'string',
  'during', 'within', 'without', 'still', 'across', 'around', 'through',
  'between', 'against',
  'number', 'boolean', 'object', 'array', 'async', 'await', 'throw', 'catch',
  'debug', 'info', 'warn', 'public', 'private', 'interface', 'module', 'package',
  'internal', 'common', 'shared', 'base', 'setup', 'init', 'index', 'utils', 'util',
  'props', 'style', 'state', 'context', 'options', 'params', 'query', 'count',
  'index', 'helper', 'helpers',
])

export interface PathMention {
  kind: 'path' | 'directory' | 'filename'
  matched: string
}

export function pathTokens(filePath: string): string[] {
  const tokens = new Set<string>()
  const segments = filePath.replace(/\\/g, '/').split('/').filter(Boolean)
  for (const segment of segments) addSegmentTokens(tokens, segment)
  return [...tokens]
}

export function issueTokens(text: string): string[] {
  const tokens = new Set<string>()
  const latin = text.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []
  for (const id of latin) addIdentifierTokens(tokens, id, true)
  const cjk = text.match(/\p{Script=Han}{2,}/gu) ?? []
  for (const run of cjk) {
    if (run.length <= 16) tokens.add(run)
  }
  return [...tokens]
}

export function diffTokens(patch: string | undefined): string[] {
  if (!patch) return []
  const tokens = new Set<string>()
  let count = 0
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith('+') && !line.startsWith('-')) continue
    if (line.startsWith('+++') || line.startsWith('---')) continue
    const latin = line.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []
    for (const id of latin) {
      addIdentifierTokens(tokens, id, true)
      count += 1
      if (count > 400) return [...tokens]
    }
  }
  return [...tokens]
}

export function tokensOverlap(left: readonly string[], right: readonly string[]): string[] {
  const matched: string[] = []
  for (const token of left) {
    if (right.some((other) => tokensMatch(token, other))) matched.push(token)
  }
  return matched
}

export function tokensMatch(left: string, right: string): boolean {
  if (left === right) return true
  const short = left.length <= right.length ? left : right
  const long = left.length <= right.length ? right : left
  return short.length >= 5 && long.startsWith(short)
}

export function distinctiveKeywords(text: string, limit = 8): string[] {
  return issueTokens(text)
    .filter((token) => !ISSUE_STOP.has(token))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, limit)
}

export function mentionedInText(text: string, filename: string): PathMention | null {
  const hay = text.replace(/\\/g, '/')
  const path = filename.replace(/\\/g, '/').replace(/^\.\//, '')
  if (hasBounded(hay, path)) return { kind: 'path', matched: path }
  const parts = path.split('/').filter(Boolean)
  for (let start = 1; start <= parts.length - 2; start += 1) {
    const suffix = parts.slice(start).join('/')
    if (parts.slice(start).length >= 2 && hasBounded(hay, suffix)) {
      return { kind: 'path', matched: suffix }
    }
  }
  for (let count = parts.length - 1; count >= 2; count -= 1) {
    const prefix = parts.slice(0, count).join('/')
    if (hasBounded(hay, prefix, { directory: true })) return { kind: 'directory', matched: prefix }
  }
  const base = parts[parts.length - 1]
  if (!base) return null
  if (!hasBounded(hay, base)) return null
  const stem = base.replace(/\.[^.]+$/, '').toLowerCase()
  if (PATH_GENERIC.has(stem) || PATH_GENERIC.has(base.toLowerCase()) || stem.length < 3) return null
  return { kind: 'filename', matched: base }
}

export function quoteForToken(text: string, token: string): string {
  return snippetAround(text, token)
}

export function directoryKey(filename: string): string {
  const parts = filename.split('/').filter(Boolean)
  if (parts.length >= 3) return `${parts[0]}/${parts[1]}`
  if (parts.length === 2) return parts[0] ?? '(root)'
  return '(root)'
}

export function allowsDiffKeywords(reasons: readonly string[]): boolean {
  return !reasons.some((reason) => reason === 'lockfile' || reason === 'env_file' || reason === 'credential')
}

export function strongDiffOverlap(tokens: readonly string[]): boolean {
  if (tokens.some((token) => token.length >= 6)) return true
  return tokens.filter((token) => token.length >= 4).length >= 2
}

function addSegmentTokens(tokens: Set<string>, segment: string): void {
  const raw = segment.trim()
  if (!raw) return
  if (raw.startsWith('.')) {
    const name = raw.slice(1).toLowerCase()
    if (name && !name.includes('.') && acceptPathToken(name)) tokens.add(name)
  }
  const stem = raw.replace(/\.[^.]+$/, '')
  addIdentifierTokens(tokens, stem, false)
}

function addIdentifierTokens(tokens: Set<string>, identifier: string, issue: boolean): void {
  const pieces = identifier
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => splitCamel(part))
  for (const piece of pieces) {
    const token = piece.toLowerCase()
    if (issue) {
      if (acceptIssueToken(token)) tokens.add(token)
    } else if (acceptPathToken(token)) {
      tokens.add(token)
    }
  }
}

function splitCamel(part: string): string[] {
  if (!part) return []
  return part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/)
}

function acceptPathToken(token: string): boolean {
  return token.length >= 3 && !/^\d+$/.test(token) && !PATH_GENERIC.has(token)
}

function acceptIssueToken(token: string): boolean {
  return token.length >= 3 && !/^\d+$/.test(token) && !ISSUE_STOP.has(token) && !PATH_GENERIC.has(token)
}
