import { strFromU8, unzipSync } from 'fflate'
import { tail } from '../text'

const ZIP_LOCAL = 0x04034b50

export function logsToText(data: string | Uint8Array): string {
  if (typeof data === 'string') {
    if (data.charCodeAt(0) === 0x50 && data.charCodeAt(1) === 0x4b) {
      const bytes = Uint8Array.from(data, (char) => char.charCodeAt(0) & 0xff)
      return unzipLogs(bytes)
    }
    return data
  }
  if (isZip(data)) return unzipLogs(data)
  return new TextDecoder().decode(data)
}

export async function downloadJobLog(options: {
  fetchImpl: typeof fetch
  token: string
  owner: string
  repo: string
  jobId: number
  maxChars: number
  maxArchiveBytes?: number
}): Promise<{ text: string | null; error?: string }> {
  const maxArchive = options.maxArchiveBytes ?? 8_000_000
  const url = `https://api.github.com/repos/${options.owner}/${options.repo}/actions/jobs/${options.jobId}/logs`
  let response: Response
  try {
    response = await options.fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pr-evidence-check',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { text: null, error: `logs request failed (${message})` }
  }
  if (!response.ok) return { text: null, error: logStatusError(response.status) }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxArchive) {
    return { text: null, error: `log archive is larger than ${maxArchive} bytes` }
  }
  try {
    return { text: tail(logsToText(bytes), options.maxChars) }
  } catch {
    return { text: null, error: 'could not read the log archive' }
  }
}

export function logStatusError(status: number): string {
  if (status === 401 || status === 403) return `logs not readable with this token (${status})`
  if (status === 404) return 'logs not found (404)'
  if (status === 410) return 'logs expired (410)'
  return `logs request failed (${status})`
}

function isZip(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(0, true) === ZIP_LOCAL
}

function unzipLogs(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  return Object.keys(files)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const file = files[name]
      return file ? `\n----- ${name} -----\n${strFromU8(file)}` : ''
    })
    .join('\n')
}
