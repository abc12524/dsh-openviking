/**
 * OpenViking REST client (v1). Direct HTTP against the OpenViking server
 * instead of its MCP surface: every operation maps to a `/api/v1/*` endpoint
 * and authenticates with the same bearer token the plugin already holds.
 *
 * Endpoint paths follow the OpenViking REST API (see docs.openviking.ai). The
 * server root is the configured `url`; a residual trailing `/mcp` is tolerated
 * and stripped.
 */

/** A minimal view of the plugin config the client needs at call time. */
export interface OvConfig {
  /** OpenViking REST server root; a residual `/mcp` suffix is stripped. */
  url: string
  /** Full bearer token (without the "Bearer " prefix). */
  key: string
  /** Per-request timeout in milliseconds. */
  timeoutMs: number
}

/** Derive the REST server root from the configured endpoint URL. */
function resolveRestBase(url: string): string {
  let base = url.trim()
  if (base.endsWith('/mcp')) base = base.slice(0, -4)
  if (base.endsWith('/')) base = base.slice(0, -1)
  return base
}

/**
 * Decode the OpenViking user identity from the bearer token. The token is three
 * dot-separated base64url segments; the second segment is the user identity
 * (e.g. `default.shell-tool.<hash>` decodes to `shell-tool`). Falls back to
 * `default` when the token shape is unexpected.
 */
export function decodeUserFromKey(key: string): string {
  const segment = key.split('.')[1]
  if (segment === undefined || segment.length === 0) return 'default'
  try {
    const decoded = Buffer.from(segment, 'base64url').toString('utf8').trim()
    return decoded.length > 0 ? decoded : 'default'
  } catch {
    return 'default'
  }
}

/** Whether an error denotes a missing target file (so `create` should be tried). */
function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /404|not found|file not found/i.test(message)
}

/** One REST round-trip; throws on non-2xx with a short error excerpt. */
async function request(
  base: string,
  key: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`OpenViking HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
  return text
}

/** Live OpenViking REST client bound to a config getter. */
export class OpenVikingRestClient {
  constructor(private readonly getConfig: () => OvConfig) {}

  private base(): string {
    const { url } = this.getConfig()
    if (url.trim() === '') throw new Error('OpenViking 未配置（url 为空）')
    return resolveRestBase(url)
  }

  private auth(): { key: string; timeoutMs: number } {
    const { key, timeoutMs } = this.getConfig()
    return { key, timeoutMs }
  }

  /** Semantic search (no session context), `openviking_search`. */
  async search(query: string, limit = 3, minScore?: number, signal?: AbortSignal): Promise<string> {
    const { key, timeoutMs } = this.auth()
    const body: Record<string, unknown> = { query, limit }
    if (minScore !== undefined) body.score_threshold = minScore
    return request(this.base(), key, '/api/v1/search/find', {
      method: 'POST',
      body: JSON.stringify(body),
    }, timeoutMs, signal)
  }

  /**
   * Save a long-term memory as a Markdown file under the user namespace. The
   * content endpoint's `replace` mode requires the file to already exist, so a
   * first-time `remember` (target file absent) 404s; on that "not found" we
   * retry with `create` so a new memory is written instead of failing.
   */
  async remember(category: string, name: string, content: string, signal?: AbortSignal): Promise<string> {
    const { key } = this.getConfig()
    const user = decodeUserFromKey(key)
    const uri = `viking://user/${user}/memories/${category}/${name}.md`
    try {
      return await this.writeFile(uri, content, 'replace', signal)
    } catch (error) {
      if (isNotFoundError(error)) return await this.writeFile(uri, content, 'create', signal)
      throw error
    }
  }

  /** Read one `viking://` file. */
  async readFile(uri: string, signal?: AbortSignal): Promise<string> {
    const { key, timeoutMs } = this.auth()
    const qs = new URLSearchParams({ uri })
    return request(this.base(), key, `/api/v1/content/read?${qs.toString()}`, {
      method: 'GET',
    }, timeoutMs, signal)
  }

  /** List a directory tree. */
  async listDir(uri: string, recursive = false, signal?: AbortSignal): Promise<string> {
    const { key, timeoutMs } = this.auth()
    const qs = new URLSearchParams({ uri, recursive: String(recursive) })
    return request(this.base(), key, `/api/v1/fs/ls?${qs.toString()}`, {
      method: 'GET',
    }, timeoutMs, signal)
  }

  /** Write a `viking://` file in create/replace/append mode. */
  async writeFile(uri: string, content: string, mode: 'create' | 'replace' | 'append', signal?: AbortSignal): Promise<string> {
    const { key, timeoutMs } = this.auth()
    return request(this.base(), key, '/api/v1/content/write', {
      method: 'POST',
      body: JSON.stringify({ uri, content, mode, wait: true }),
    }, timeoutMs, signal)
  }

  /** Create a conversation session. */
  async createSession(sessionId = '', signal?: AbortSignal): Promise<string> {
    const { key, timeoutMs } = this.auth()
    const body = sessionId === '' ? {} : { session_id: sessionId }
    return request(this.base(), key, '/api/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }, timeoutMs, signal)
  }

  /** Append one message to a session. */
  async addMessage(sessionId: string, role: string, content: string, signal?: AbortSignal): Promise<string> {
    const { key, timeoutMs } = this.auth()
    return request(this.base(), key, `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role, content }),
    }, timeoutMs, signal)
  }

  /** Archive a session and extract structured long-term memory. */
  async commitSession(sessionId: string, keepRecent = 0, signal?: AbortSignal): Promise<string> {
    const { key, timeoutMs } = this.auth()
    return request(this.base(), key, `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`, {
      method: 'POST',
      body: JSON.stringify({ keep_recent_count: keepRecent }),
    }, timeoutMs, signal)
  }

  /** Delete a `viking://` file (irreversible). */
  async deleteFile(uri: string, signal?: AbortSignal): Promise<string> {
    const { key, timeoutMs } = this.auth()
    const qs = new URLSearchParams({ uri, recursive: 'false' })
    return request(this.base(), key, `/api/v1/fs?${qs.toString()}`, {
      method: 'DELETE',
    }, timeoutMs, signal)
  }
}
