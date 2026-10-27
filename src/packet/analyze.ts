import { stripHtmlComments } from '../text'
import type { PacketReport, PacketSection, PacketSectionId, ReviewPacketConfig } from '../types'

const PLACEHOLDER = /^(?:todo|tbd|n\/a|na|none|nil|null|placeholder|待填|待补充|待定|暂无|无|略|同上|xxx+|…+|\.{2,}|-+|\?+|fill this in|describe here|待写)$/i

export function analyzePacket(body: string, config: ReviewPacketConfig): PacketReport {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const aliases = allAliases(config)
  const sections: PacketSection[] = (Object.keys(config.headings) as PacketSectionId[]).map((id) => {
    const headings = config.headings[id]
    const found = lines.flatMap((line, index) => {
      const heading = headingText(line)
      if (!heading || !headings.some((alias) => headingMatches(heading, alias))) return []
      const content = sectionBody(lines, index, aliases)
      const assessed = assessContent(content, config.minBodyChars)
      return [{ heading, ...assessed }]
    })
    const best = found.sort((a, b) => rank(b.status) - rank(a.status) || b.chars - a.chars)[0]
    if (!best) return { id, status: 'missing', chars: 0 }
    return { id, status: best.status, heading: best.heading, chars: best.chars }
  })
  const incomplete = sections.some((section) => section.status !== 'present')
  return {
    enabled: true,
    status: incomplete ? config.incomplete : 'pass',
    sections,
  }
}

export function skippedPacket(): PacketReport {
  return { enabled: false, status: 'skipped', sections: [] }
}

export function headingText(line: string): string | null {
  const trimmed = line.trim()
  const atx = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed)
  if (atx?.[2]) return atx[2].trim()
  const bold = /^\*\*(.+?)\*\*\s*$/.exec(trimmed)
  if (bold?.[1]) return bold[1].trim()
  const label = /^(.{1,80}?)\s*[:：]\s*$/.exec(trimmed)
  if (label?.[1] && !label[1].includes('。') && !label[1].includes('.')) return label[1].trim()
  return null
}

export function normalizeHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[*_`#]/g, '')
    .replace(/[:：]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function headingMatches(heading: string, alias: string): boolean {
  const left = normalizeHeading(heading)
  const right = normalizeHeading(alias)
  if (!left || !right) return false
  return left === right || left.startsWith(`${right} `)
}

export function assessContent(content: string, minChars: number): { status: 'present' | 'empty' | 'placeholder'; chars: number } {
  const stripped = stripHtmlComments(content)
  const meaningful = stripped
    .split(/\n/)
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/[`*_>#]/g, '').trim())
    .filter((line) => line.length > 0 && !/^<!--/.test(line))
  if (meaningful.length === 0) return { status: 'empty', chars: 0 }
  const chars = meaningful.join('\n').trim().length
  if (meaningful.every((line) => PLACEHOLDER.test(line.replace(/\s+/g, ' ').trim()))) {
    return { status: 'placeholder', chars }
  }
  if (chars < minChars) return { status: 'empty', chars }
  return { status: 'present', chars }
}

function sectionBody(lines: readonly string[], start: number, aliases: readonly string[]): string {
  const body: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (isBoundary(line, aliases)) break
    body.push(line)
  }
  return body.join('\n')
}

function isBoundary(line: string, aliases: readonly string[]): boolean {
  const trimmed = line.trim()
  if (/^#{1,6}\s+/.test(trimmed)) return true
  const heading = headingText(line)
  if (!heading) return false
  return aliases.some((alias) => headingMatches(heading, alias))
}

function allAliases(config: ReviewPacketConfig): string[] {
  return Object.values(config.headings).flat()
}

function rank(status: PacketSection['status']): number {
  if (status === 'present') return 3
  if (status === 'placeholder') return 2
  if (status === 'empty') return 1
  return 0
}
