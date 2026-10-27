import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/config'
import { analyzePacket, assessContent, headingMatches } from '../src/packet/analyze'

const config = defaultConfig().reviewPacket

describe('review packet', () => {
  it('accepts English and Chinese headings, including bold and label lines', () => {
    const body = [
      '## Intent',
      'Stop the session timeout.',
      '**风险**',
      'Login might loop if the refresh fails.',
      'Tests run:',
      'npm test, 42 passed.',
      '## 本人验证',
      'I signed in locally and waited past the old timeout.',
    ].join('\n')
    const report = analyzePacket(body, config)
    expect(report.status).toBe('pass')
    expect(report.sections.map((section) => section.status)).toEqual(['present', 'present', 'present', 'present'])
  })

  it('passes when the English section is filled and the Chinese heading in the template is empty', () => {
    const body = [
      '## Intent',
      'Refresh the session before it expires.',
      '## 意图',
      '',
      '## Risks',
      'None beyond the login path, which I checked.',
      '## 风险',
      'TODO',
      '## Tests run',
      'CI unit job passed.',
      '## 已运行测试',
      '',
      '## Self-verification',
      'Logged in and waited two minutes.',
      '## 本人验证',
      '',
    ].join('\n')
    const report = analyzePacket(body, config)
    expect(report.status).toBe('pass')
    expect(report.sections.find((section) => section.id === 'risks')?.heading).toBe('Risks')
  })

  it('distinguishes missing, empty, and placeholder sections', () => {
    const body = [
      '## Intent',
      'Short',
      '## Risks',
      'TODO',
      '## Tests run',
      '<!-- npm test -->',
    ].join('\n')
    const report = analyzePacket(body, config)
    expect(report.status).toBe('warn')
    expect(report.sections.map((section) => [section.id, section.status])).toEqual([
      ['intent', 'empty'],
      ['risks', 'placeholder'],
      ['testsRun', 'empty'],
      ['selfVerification', 'missing'],
    ])
  })

  it('can raise incomplete packets to error and ignores HTML comments', () => {
    const report = analyzePacket('## Intent\n\nReal intent is here.', {
      ...config,
      incomplete: 'error',
    })
    expect(report.status).toBe('error')
    expect(assessContent('<!-- hidden -->\n\nActual text here.', 8).status).toBe('present')
    expect(headingMatches('Tests Run locally', 'Tests run')).toBe(true)
    expect(headingMatches('Not the intent', 'Intent')).toBe(false)
  })

  it('uses a custom heading list when one is configured', () => {
    const report = analyzePacket('## Why\n\nBecause the session expired too soon.', {
      ...config,
      headings: { ...config.headings, intent: ['Why'] },
    })
    expect(report.sections.find((section) => section.id === 'intent')?.status).toBe('present')
  })
})
