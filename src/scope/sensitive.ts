import { minimatch } from 'minimatch'
import type { SensitiveHit, SensitiveRule } from '../types'
import { mentionedInText } from './tokenize'

export const BUILTIN_SENSITIVE: readonly SensitiveRule[] = [
  {
    id: 'lockfiles',
    reason: 'lockfile',
    patterns: [
      '**/package-lock.json',
      '**/pnpm-lock.yaml',
      '**/yarn.lock',
      '**/npm-shrinkwrap.json',
      '**/bun.lock',
      '**/bun.lockb',
      '**/Cargo.lock',
      '**/go.sum',
      '**/Gemfile.lock',
      '**/poetry.lock',
      '**/composer.lock',
      '**/Pipfile.lock',
      '**/packages.lock.json',
      '**/gradle.lockfile',
      '**/pubspec.lock',
      '**/mix.lock',
      '**/flake.lock',
    ],
  },
  {
    id: 'github-workflows',
    reason: 'github_workflow',
    patterns: ['**/.github/workflows/**', '**/.github/actions/**'],
  },
  {
    id: 'github-settings',
    reason: 'github_settings',
    patterns: [
      '**/.github/CODEOWNERS',
      '**/CODEOWNERS',
      '**/.github/dependabot.yml',
      '**/.github/dependabot.yaml',
      '**/dependabot.yml',
      '**/dependabot.yaml',
      '**/.github/pr-evidence.yml',
    ],
  },
  {
    id: 'env-files',
    reason: 'env_file',
    patterns: ['**/.env', '**/.env.*'],
  },
  {
    id: 'credentials',
    reason: 'credential',
    patterns: [
      '**/*.pem',
      '**/*.key',
      '**/*.p12',
      '**/*.pfx',
      '**/id_rsa',
      '**/id_rsa.*',
      '**/id_ed25519',
      '**/id_ed25519.*',
      '**/*.keystore',
      '**/secrets/**',
      '**/.secrets/**',
      '**/secrets.*',
      '**/*-secrets.*',
      '**/*_secrets.*',
    ],
  },
  {
    id: 'docker',
    reason: 'container',
    patterns: [
      '**/Dockerfile',
      '**/Dockerfile.*',
      '**/.dockerignore',
      '**/docker-compose*.yml',
      '**/docker-compose*.yaml',
      '**/compose.yml',
      '**/compose.yaml',
    ],
  },
  {
    id: 'package-manifest',
    reason: 'manifest',
    patterns: [
      '**/package.json',
      '**/Cargo.toml',
      '**/go.mod',
      '**/pyproject.toml',
      '**/Gemfile',
      '**/composer.json',
      '**/pom.xml',
      '**/build.gradle',
      '**/build.gradle.kts',
    ],
  },
  {
    id: 'ci-other',
    reason: 'ci_config',
    patterns: [
      '**/.circleci/**',
      '**/.gitlab-ci.yml',
      '**/azure-pipelines*.yml',
      '**/Jenkinsfile',
      '**/.buildkite/**',
    ],
  },
  {
    id: 'tooling-config',
    reason: 'tooling_config',
    patterns: [
      '**/tsconfig*.json',
      '**/jsconfig*.json',
      '**/jest.config.*',
      '**/vitest.config.*',
      '**/vite.config.*',
      '**/webpack.config.*',
      '**/eslint.config.*',
      '**/.eslintrc*',
      '**/.prettierrc*',
      '**/prettier.config.*',
      '**/.nvmrc',
      '**/.node-version',
      '**/.python-version',
      '**/Makefile',
      '**/.editorconfig',
      '**/babel.config.*',
    ],
  },
]

const MATCH_OPTIONS = { dot: true, nocase: true }

export function activeSensitiveRules(disabledIds: readonly string[], extraPaths: readonly string[]): SensitiveRule[] {
  const disabled = new Set(disabledIds)
  const rules = BUILTIN_SENSITIVE.filter((rule) => !disabled.has(rule.id)).map((rule) => ({
    ...rule,
    patterns: [...rule.patterns],
  }))
  if (extraPaths.length > 0) {
    rules.push({ id: 'custom', reason: 'custom', patterns: [...extraPaths] })
  }
  return rules
}

export function matchSensitive(
  filename: string,
  rules: readonly SensitiveRule[],
  issueTexts: readonly string[],
): SensitiveHit[] {
  const normalized = filename.replace(/\\/g, '/')
  const hits: SensitiveHit[] = []
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (!minimatch(normalized, pattern, MATCH_OPTIONS)) continue
      const mention = mentionFor(normalized, issueTexts)
      hits.push({
        ruleId: rule.id,
        reason: rule.reason,
        pattern,
        mentioned: mention != null,
        ...(mention ? { mention } : {}),
      })
      break
    }
  }
  return hits
}

export function matchIgnore(filename: string, patterns: readonly string[]): string | undefined {
  const normalized = filename.replace(/\\/g, '/')
  for (const pattern of patterns) {
    if (minimatch(normalized, pattern, MATCH_OPTIONS)) return pattern
  }
  return undefined
}

function mentionFor(filename: string, issueTexts: readonly string[]): string | undefined {
  for (const text of issueTexts) {
    const mention = mentionedInText(text, filename)
    if (mention) return mention.matched
  }
  return undefined
}
