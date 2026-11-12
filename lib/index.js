/**
 * dsh-openviking — the OpenViking memory backend for DeepSeek Harness.
 *
 * This plugin owns exactly one thing: talking to an OpenViking server. It scans
 * nothing, injects nothing, and knows nothing about turns or steps. It publishes
 * the `openviking` Cordis service, and any plugin that wants recalled memories
 * asks for them:
 *
 *     const ov = ctx.get('openviking')
 *     if (ov?.configured()) {
 *       const { text, count } = await ov.find('用户之前说过什么偏好', { signal })
 *     }
 *
 * The split exists because retrieval and injection have different lifetimes.
 * Connection details, the bearer token, the similarity threshold and the hit
 * count belong to the memory backend (`dsh-openviking`, with its own settings
 * card); *when* to ask, how to wrap the answer and where to put it in the
 * message list belong to the injector (`dsh-inject-context`). Before the split
 * both lived in one plugin, so the connection settings and the injection policy
 * could not be changed independently.
 *
 * What the service returns is text, not structured data: the caller is a prompt
 * builder, and every consumer of OpenViking renders the same `uri / score /
 * abstract` rows. Rows are rendered here so the format stays identical no
 * matter which plugin asks; the caller adds its own boundary framing and wraps
 * the block for the model.
 *
 * Failure policy:
 *
 *   - `find()` rejects on a transport error, a non-2xx status, or a 200 with a
 *     body that is not JSON. A JSON endpoint answers either with JSON or with
 *     an error status, so an unparseable body means something else answered —
 *     a proxy, a wrong port, an HTML error page — and returning "no memories"
 *     would hide a broken deployment. The caller decides whether that degrades
 *     to "inject nothing" (the injector does).
 *   - An ordinary empty result is NOT a failure: `{ text: '', count: 0 }`.
 *   - `profile()` is deliberately soft: the memory index is an aid, and a
 *     recall without it is still better than no recall.
 *
 * @module dsh-openviking
 */

import z from '@deepseek-ai/schemastery'

/** Stable plugin id, matching the loader entry id in cordis.patch.yml. */
export const name = 'dsh-openviking'

/**
 * Required services. Intentionally empty: the credentials domain is looked up
 * opportunistically, and nothing here touches `systemPrompt`, `tools`, or the
 * message pipeline.
 */
export const inject = []

/** Cordis service name other plugins read. */
export const SERVICE = 'openviking'

/**
 * The plugin's configuration.
 *
 * The first block is `.volatile()` — the fields that reach the settings card on
 * the Plugins page: where the server is (`host` + `port`), how many hits to ask
 * for (`limit`), how similar a hit must be (`scoreThreshold`), and the bearer
 * token. The token itself is never a configuration value: `apiKeyEnv` names a
 * credential reference and the secret is owned by the credentials domain, so
 * the literal never lands in the profile patch of a public repository.
 *
 * The rest is ordinary configuration, edited only in a profile's Cordis patch.
 * Keys carry no dots (they are top-level form fields); `SettingsFormModel` can
 * only address top-level keys, and a dotted literal would be re-read as a
 * nested path when the patch is written back.
 */
export const Config = z.object({
  /** Master switch: off makes {@link status}.configured report false. */
  enabled: z.boolean().default(true).volatile(),
  /**
   * OpenViking host. `192.168.30.181`, `ov.example.com`, `https://ov.example.com`
   * and `10.0.0.5:1933` are all accepted; a scheme typed here wins over
   * {@link Config.scheme}, and a port typed here wins over {@link Config.port}.
   */
  host: z.string().default('').volatile(),
  /** Port used when {@link Config.host} does not carry one. */
  port: z.number().step(1).min(1).default(1933).volatile(),
  /** Minimum similarity a memory must reach to be returned. */
  scoreThreshold: z.number().min(0).max(1).default(0.4).volatile(),
  /** How many memories to request per query. */
  limit: z.number().step(1).min(1).default(3).volatile(),

  // --- Ordinary configuration (profile patch only) ---
  /** Scheme used when {@link Config.host} does not carry one. */
  scheme: z.string().default('http'),
  /** Credential reference holding the bearer token. */
  apiKeyEnv: z.string().role('credential-ref').default('OPENVIKING_API_KEY'),
  /** Acting user, sent as `X-OpenViking-User`; also the memory-root owner. */
  user: z.string().default(''),
  /** Account scope, sent as `X-OpenViking-Account`. */
  account: z.string().default('default'),
  /** Peer identity, sent as `X-OpenViking-Peer`. */
  peer: z.string().default('default'),
  /**
   * Characters kept from each memory's abstract; 0 keeps it whole.
   *
   * OpenViking returns abstracts up to roughly 1.6k characters on the reference
   * deployment, so a small fixed cut would discard most of the richest memory.
   */
  abstractChars: z.number().step(1).min(0).default(1200),
  /** How many entries the memory index (`profile()`) may list. */
  profileLimit: z.number().step(1).min(1).default(40),
  /** Character budget for the memory index; 0 keeps it whole. */
  profileChars: z.number().step(1).min(0).default(2000),
  /** Per-request abort deadline; 0 disables the guard. */
  timeoutMs: z.number().step(1).min(0).default(3000),
})

/** Marker that opens the recall block body, shared with the injector's README. */
export const RECALL_MARKER = '## 📖 相关记忆'

/** Marker that opens the memory index block. */
export const PROFILE_MARKER = '## 🧠 记忆索引'

/** The grammar `credentialRef()` enforces; checked here so a typo cannot throw. */
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Credential reference used when the section names none. */
const DEFAULT_API_KEY_REF = 'OPENVIKING_API_KEY'

/** Port assumed when neither the host nor the config names one. */
const DEFAULT_PORT = 1933

// ---------------------------------------------------------------------------
// Configuration access
// ---------------------------------------------------------------------------

/**
 * Read one configuration value.
 *
 * A `.volatile()` field arrives as a live reference — the settings service can
 * replace its value without remounting the plugin — so the value sits behind
 * `.get()`. An ordinary field arrives as a plain value. Reading every field
 * through this helper keeps both shapes working and always observes the current
 * value, so a settings edit applies from the next query.
 *
 * @param config - the resolved plugin configuration.
 * @param key - field name.
 * @param fallback - value used when the field is absent, null, or undefined.
 * @returns the current value, or `fallback`.
 */
function readConfig(config, key, fallback) {
  const field = config?.[key]
  let value = field
  if (field !== null && typeof field === 'object' && typeof field.get === 'function') {
    try {
      value = field.get()
    } catch {
      return fallback
    }
  }
  return value === undefined || value === null ? fallback : value
}

/**
 * Coerce a value to a finite number, defaulting to 0.
 * @param value - the candidate.
 * @returns the number, or 0.
 */
function asNumber(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Cut a string to `max` characters, marking the cut with an ellipsis.
 * @param text - the text to cut.
 * @param max - the budget; non-finite or non-positive keeps the text whole.
 * @returns the text, or a marked prefix of it.
 */
function clip(text, max) {
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text
  return `${text.slice(0, max)}…`
}

/**
 * Combine the caller's cancellation with a per-request deadline.
 *
 * `AbortSignal.any` is available on every supported Node version; when it is
 * missing, the caller's signal alone is used.
 *
 * @param signal - the caller's cancellation signal, when one was passed.
 * @param ms - the budget; non-finite or non-positive disables the deadline.
 * @returns the signal to hand `fetch`.
 */
function requestSignal(signal, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return signal
  const deadline = AbortSignal.timeout(ms)
  if (signal === undefined || signal === null) return deadline
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, deadline]) : signal
}

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

/**
 * The API root, e.g. `http://192.168.30.181:1933`.
 *
 * The scheme is taken from the host when the user typed one and falls back to
 * `scheme`; a port typed into the host wins over the `port` field. This accepts
 * `ov.example.com`, `ov.example.com:1933`, `10.0.0.5` and
 * `https://ov.example.com` alike, so a settings typo degrades to a failed
 * request rather than to a malformed-URL exception.
 *
 * @param config - the resolved plugin configuration.
 * @returns the base URL, or `undefined` when no host is configured.
 */
function baseUrl(config) {
  const raw = String(readConfig(config, 'host', '')).trim()
  if (raw.length === 0) return undefined
  const schemeMatch = /^(https?):\/\//i.exec(raw)
  const scheme = schemeMatch === null
    ? (String(readConfig(config, 'scheme', 'http')).trim().toLowerCase() || 'http')
    : schemeMatch[1].toLowerCase()
  const authority = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  if (authority.length === 0) return undefined
  if (/:\d+$/.test(authority)) return `${scheme}://${authority}`
  const port = Math.floor(asNumber(readConfig(config, 'port', DEFAULT_PORT)))
  const safePort = Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT
  return `${scheme}://${authority}:${safePort}`
}

/**
 * Resolve the bearer token from the credentials domain.
 *
 * The literal is never read from configuration. `apiKeyEnv` names a reference
 * and the credentials service owns the secret (`~/.dsh/.credentials.yaml`,
 * written by the settings card), which is what keeps the token out of the
 * profile patch and out of this public repository.
 *
 * An empty result is not fatal: the server answers 401 and the caller's catch
 * degrades to "retrieve nothing", which is the documented contract.
 *
 * @param ctx - the plugin's Cordis context.
 * @param config - the resolved plugin configuration.
 * @returns the token, or `undefined` when none is configured or reachable.
 */
async function resolveApiKey(ctx, config) {
  const declared = String(readConfig(config, 'apiKeyEnv', DEFAULT_API_KEY_REF)).trim()
  const ref = declared.length > 0 ? declared : DEFAULT_API_KEY_REF
  if (!CREDENTIAL_REF_PATTERN.test(ref)) return undefined
  let credentials
  try {
    credentials = ctx.get('credentials')
  } catch {
    return undefined
  }
  if (credentials === undefined || credentials === null || typeof credentials.resolve !== 'function') return undefined
  try {
    const resolved = await credentials.resolve(ref)
    const value = resolved?.value
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Build the request headers shared by every OpenViking route.
 * @param ctx - the plugin's Cordis context, for the credentials domain.
 * @param config - the resolved plugin configuration.
 * @returns the headers for any OpenViking request.
 */
async function memoryHeaders(ctx, config) {
  const apiKey = await resolveApiKey(ctx, config)
  return {
    Authorization: `Bearer ${apiKey ?? ''}`,
    'Content-Type': 'application/json',
    'X-OpenViking-Account': String(readConfig(config, 'account', 'default')),
    'X-OpenViking-User': String(readConfig(config, 'user', '')),
    'X-OpenViking-Peer': String(readConfig(config, 'peer', 'default')),
  }
}

// ---------------------------------------------------------------------------
// Recall (`POST /api/v1/search/find`)
// ---------------------------------------------------------------------------

/**
 * Pull the memory entries out of a `find` response.
 *
 * The endpoint's envelope has moved between releases, so every observed shape
 * is accepted (`result` as an array, `result` as an object holding
 * `memories` / `resources` / `skills` or `hits` / `items` / `results`, or a
 * top-level `memories`). Entries are deduplicated by `uri` and sorted by score
 * so that truncation keeps the best matches.
 *
 * @param data - the parsed response body.
 * @returns normalized entries, best first.
 */
function extractMemories(data) {
  if (!data || typeof data !== 'object') return []
  const raw = data.result
  let items = []
  if (Array.isArray(raw)) {
    items = raw
  } else if (raw && typeof raw === 'object') {
    for (const key of ['memories', 'resources', 'skills']) {
      if (Array.isArray(raw[key])) items.push(...raw[key])
    }
    if (items.length === 0) {
      for (const key of ['hits', 'items', 'results']) {
        if (Array.isArray(raw[key])) {
          items = raw[key]
          break
        }
      }
    }
  } else if (Array.isArray(data.memories)) {
    items = data.memories
  }

  const seen = new Set()
  const out = []
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue
    const uri = entry.uri
    if (typeof uri === 'string' && uri.length > 0) {
      if (seen.has(uri)) continue
      seen.add(uri)
    }
    out.push(entry)
  }
  out.sort((a, b) => asNumber(b.score) - asNumber(a.score))
  return out
}

/**
 * Render the recall block body (marker + one row per memory).
 *
 * Scores print to three decimals on purpose: similarities live in a narrow band
 * (roughly 0.25 for noise to 0.68 for a strong match), so two decimals would
 * collapse distinct ranks into the same number and hide exactly the ordering
 * the model is being asked to weigh.
 *
 * @param memories - entries from {@link extractMemories}.
 * @param abstractChars - per-entry character budget; 0 keeps each abstract whole.
 * @returns the block body, or `''` when no entry carries text.
 */
function renderMemories(memories, abstractChars) {
  const lines = []
  for (const m of memories) {
    const abstract = m.abstract || m.content || ''
    if (!abstract) continue
    const uri = typeof m.uri === 'string' ? m.uri : ''
    const ctype = typeof m.context_type === 'string' ? m.context_type : ''
    lines.push(`- [${uri}] (score=${asNumber(m.score).toFixed(3)}, ${ctype})\n  ${clip(String(abstract), abstractChars)}`)
  }
  if (lines.length === 0) return ''
  return `${RECALL_MARKER}\n${lines.join('\n')}`
}

/**
 * Query the memory store for memories related to `query`.
 *
 * @param ctx - the plugin's Cordis context.
 * @param config - the resolved plugin configuration.
 * @param query - the text to search for.
 * @param options - optional cancellation.
 * @returns the rendered rows and how many memories they cover.
 */
async function findMemories(ctx, config, query, { signal } = {}) {
  const text = String(query ?? '').trim()
  const base = baseUrl(config)
  if (text.length === 0 || base === undefined) return { text: '', count: 0 }

  const headers = await memoryHeaders(ctx, config)
  const timeoutMs = asNumber(readConfig(config, 'timeoutMs', 3000))
  const response = await fetch(`${base}/api/v1/search/find`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: text,
      score_threshold: asNumber(readConfig(config, 'scoreThreshold', 0.4)),
      limit: asNumber(readConfig(config, 'limit', 3)),
    }),
    signal: requestSignal(signal, timeoutMs),
  })
  if (!response.ok) throw new Error(`find HTTP ${response.status}`)

  const data = await response.json()
  const memories = extractMemories(data)
  const body = renderMemories(memories, asNumber(readConfig(config, 'abstractChars', 1200)))
  return { text: body, count: memories.length }
}

// ---------------------------------------------------------------------------
// Memory index (`GET /api/v1/fs/tree`)
// ---------------------------------------------------------------------------

/**
 * Candidate memory roots, most specific first.
 *
 * The peer-scoped root is the default; the user root is the fallback for a
 * deployment that never enabled peer isolation. An empty list means the user
 * name is unknown, and there is nothing to address.
 *
 * @param config - the resolved plugin configuration.
 * @returns the `viking://` roots to probe, in order.
 */
function memoryRootCandidates(config) {
  const user = String(readConfig(config, 'user', '')).trim()
  if (user.length === 0) return []
  const peer = String(readConfig(config, 'peer', 'default')).trim() || 'default'
  return [
    `viking://user/${user}/peers/${peer}/memories/`,
    `viking://user/${user}/memories/`,
  ]
}

/**
 * Pull entry names out of a `/api/v1/fs/tree` response.
 *
 * The envelope has moved between releases, so every observed shape is accepted
 * (`result` as the container, or the list directly on the root) and every
 * observed item field is read (`name` / `title` / the last `uri` segment).
 *
 * @param data - the parsed response body.
 * @returns distinct entry names in response order.
 */
function extractTreeEntries(data) {
  if (!data || typeof data !== 'object') return []
  const containers = []
  if (data.result && typeof data.result === 'object') containers.push(data.result)
  for (const key of ['entries', 'list', 'children', 'files', 'nodes']) {
    if (Array.isArray(data[key])) containers.push({ [key]: data[key] })
  }
  const names = []
  for (const container of containers) {
    const items = container.entries ?? container.list ?? container.children ?? container.files ?? container.nodes
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (typeof item === 'string') {
        if (item.length > 0) names.push(item)
        continue
      }
      if (!item || typeof item !== 'object') continue
      const uriTail = typeof item.uri === 'string' ? item.uri.replace(/\/+$/, '').split('/').pop() : ''
      const entryName = item.name ?? item.title ?? uriTail
      if (typeof entryName === 'string' && entryName.length > 0) names.push(entryName)
    }
  }
  const seen = new Set()
  const out = []
  for (const entryName of names) {
    if (seen.has(entryName)) continue
    seen.add(entryName)
    out.push(entryName)
  }
  return out
}

/**
 * Fetch the memory index: what topics the store holds.
 *
 * Failures are deliberately soft — the index is an aid, and a recall without it
 * is still better than no recall — unless the caller's own signal was aborted,
 * which must propagate rather than be swallowed.
 *
 * @param ctx - the plugin's Cordis context.
 * @param config - the resolved plugin configuration.
 * @param options - optional cancellation.
 * @returns the index block, or `''` when no root answers.
 */
async function fetchProfile(ctx, config, { signal } = {}) {
  const base = baseUrl(config)
  if (base === undefined) return ''
  const roots = memoryRootCandidates(config)
  if (roots.length === 0) return ''
  const headers = await memoryHeaders(ctx, config)
  const limit = Math.max(1, Math.floor(asNumber(readConfig(config, 'profileLimit', 40))))
  const budget = asNumber(readConfig(config, 'profileChars', 2000))
  const timeoutMs = asNumber(readConfig(config, 'timeoutMs', 3000))
  for (const root of roots) {
    let data
    try {
      const response = await fetch(`${base}/api/v1/fs/tree?uri=${encodeURIComponent(root)}`, {
        headers,
        signal: requestSignal(signal, timeoutMs),
      })
      if (!response.ok) continue
      data = await response.json()
    } catch (error) {
      if (signal?.aborted) throw error
      continue
    }
    const entries = extractTreeEntries(data)
    if (entries.length === 0) continue
    const lines = entries.slice(0, limit).map((entry) => `- ${entry}`)
    return clip(`${PROFILE_MARKER}\n可用记忆索引（主题概览）：\n${lines.join('\n')}`, budget)
  }
  return ''
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * The `openviking` service.
 *
 * @typedef {object} OpenvikingService
 * @property {() => { configured: boolean, base?: string }} status
 *   Whether a host is configured and, when it is, the base URL in force.
 * @property {(query: string, options?: { signal?: AbortSignal }) => Promise<{ text: string, count: number }>} find
 *   Recall rows for a query. `text` is the rendered block body, `''` when there
 *   is nothing relevant; rejects on a transport or protocol failure.
 * @property {(options?: { signal?: AbortSignal }) => Promise<string>} profile
 *   The memory index block, `''` when unavailable.
 */

/**
 * Build the service over the plugin's live configuration.
 *
 * Every method reads the configuration at call time, never at mount time, so a
 * settings edit applies to the next query without a remount.
 *
 * @param ctx - the plugin's Cordis context.
 * @param config - the resolved plugin configuration.
 * @returns the service object.
 */
function createService(ctx, config) {
  return {
    status() {
      const base = baseUrl(config)
      const on = readConfig(config, 'enabled', true) !== false
      return on && base !== undefined ? { configured: true, base } : { configured: false }
    },
    async find(query, options = {}) {
      if (readConfig(config, 'enabled', true) === false) return { text: '', count: 0 }
      return await findMemories(ctx, config, query, options)
    },
    async profile(options = {}) {
      if (readConfig(config, 'enabled', true) === false) return ''
      return await fetchProfile(ctx, config, options)
    },
  }
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

/**
 * Publish the service.
 *
 * @param ctx - the Cordis context owning this plugin.
 * @param rawConfig - the resolved Config.
 * @returns an effect disposer that withdraws the service.
 */
export function apply(ctx, rawConfig) {
  const service = createService(ctx, rawConfig)
  try {
    ctx.provide(SERVICE, service)
  } catch (error) {
    // A duplicate registration means another mount already serves this name;
    // the first one wins and the settings card still works.
    ctx.logger?.warn?.(`${name}: could not publish ${SERVICE} (${String(error)})`)
  }
  let released = false
  return () => {
    if (released) return
    released = true
  }
}
