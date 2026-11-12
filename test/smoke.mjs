/**
 * Smoke test for dsh-openviking.
 *
 * Two halves are exercised without a running harness:
 *
 *   - The host half is driven against a mock Cordis context: the service it
 *     publishes is called directly, and every request it issues is asserted
 *     against the wire shape OpenViking expects.
 *   - The browser half is loaded through a stand-in for the Client module
 *     loader, and its Plugins-page registration is asserted directly.
 *
 * The real `@deepseek-ai/schemastery` is used, so the `Config` assertions below
 * hold for the schema the settings service actually projects.
 *
 * Run: node test/smoke.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { Config, PROFILE_MARKER, RECALL_MARKER, SERVICE, apply, inject, name } from '../lib/index.js'

// ---------------------------------------------------------------------------
// Mock Cordis context
// ---------------------------------------------------------------------------

function makeCtx({ credentials } = {}) {
  const logs = []
  const provided = new Map()
  return {
    logs,
    provided,
    logger: {
      info: (m) => logs.push(['info', m]),
      warn: (m) => logs.push(['warn', m]),
    },
    provide(serviceName, service) {
      if (provided.has(serviceName)) throw new Error(`${serviceName} already provided`)
      provided.set(serviceName, service)
    },
    get(serviceName) {
      if (serviceName === 'credentials') return credentials
      return provided.get(serviceName)
    },
  }
}

// ---------------------------------------------------------------------------
// Fetch stand-in
// ---------------------------------------------------------------------------

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

let fetchCalls = []
let fetchImpl = async () => jsonResponse({ result: { memories: [] } })
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init })
  return fetchImpl(url, init)
}

/** Stands in for a real OpenViking abstract, which runs to ~1.6k characters. */
const LONG_ABSTRACT = `长记忆 ${'A'.repeat(1500)} 结尾标记`

const MEMORY_BODY = {
  // Shape captured from a live OpenViking /api/v1/search/find response:
  // { status, result: { memories: [{context_type, uri, level, score, abstract, tags}], resources, skills, total } }
  result: {
    memories: [
      { uri: 'viking://mem/1', score: 0.91, abstract: '用户偏好深色主题', context_type: 'memory', level: 2, tags: [] },
      { uri: 'viking://mem/2', score: 0.72, abstract: '项目使用 pnpm', context_type: 'memory', level: 2, tags: [] },
      { uri: 'viking://mem/1', score: 0.91, abstract: 'duplicate uri', context_type: 'memory', level: 2, tags: [] },
      { uri: 'viking://mem/4', score: 0.55, abstract: LONG_ABSTRACT, context_type: 'memory', level: 2, tags: [] },
    ],
    resources: [],
    skills: [],
    total: 4,
  },
}

const credentials = {
  async resolve(ref) {
    return ref === 'TEST_KEY' ? { value: 'test-token-123' } : undefined
  },
}

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  host: 'ov.test',
  user: 'alice',
  apiKeyEnv: 'TEST_KEY',
}

function mount(overrides = {}) {
  const ctx = makeCtx({ credentials })
  const config = Config({ ...BASE_CONFIG, ...overrides })
  const dispose = apply(ctx, config)
  const service = ctx.provided.get(SERVICE)
  return { ctx, config, dispose, service }
}

console.log('fixture: mock Cordis context + fetch stand-in\n')

// ---------------------------------------------------------------------------
// Case 1 — the exported Config is the shape the settings service projects.
// ---------------------------------------------------------------------------

assert.equal(name, 'dsh-openviking')
assert.deepEqual(inject, [], 'the plugin declares no hard service dependency')
assert.equal(Config.type, 'object')

const VOLATILE_FIELDS = ['enabled', 'host', 'port', 'scoreThreshold', 'limit']
const ORDINARY_FIELDS = [
  'scheme',
  'apiKeyEnv',
  'user',
  'account',
  'peer',
  'abstractChars',
  'profileLimit',
  'profileChars',
  'timeoutMs',
]

for (const field of VOLATILE_FIELDS) {
  assert.equal(Config.dict[field]?.meta?.volatile, true, `${field} must be volatile to reach the settings form`)
}
for (const field of ORDINARY_FIELDS) {
  assert.notEqual(Config.dict[field]?.meta?.volatile, true, `${field} is ordinary configuration, not a form field`)
}
assert.equal(
  Config.dict['apiKeyEnv']?.meta?.role,
  'credential-ref',
  'the key field names a credential; the literal must never live in configuration',
)
assert.equal(
  Object.values(Config.dict).some((child) => child.meta?.role === 'secret'),
  false,
  'no field holds a secret literal',
)

// A volatile field arrives as a live reference, an ordinary one as a plain
// value — the two shapes readConfig() has to cover.
const liveConfig = Config({ ...BASE_CONFIG })
assert.equal(typeof liveConfig.host?.get, 'function', 'volatile fields arrive as live references')
assert.equal(liveConfig.host.get(), 'ov.test')
assert.equal(typeof liveConfig.timeoutMs, 'number', 'ordinary fields arrive as plain values')
assert.equal(liveConfig.timeoutMs, 3000)

console.log(`case 1  ok  Config: ${VOLATILE_FIELDS.length} volatile fields, credential-ref key, both value shapes`)

// ---------------------------------------------------------------------------
// Case 2 — the service is published and reports its state.
// ---------------------------------------------------------------------------

{
  const { service, ctx, dispose } = mount()
  assert.ok(service, `apply must publish the ${SERVICE} service`)
  assert.deepEqual(ctx.provided.keys().next().value, SERVICE)
  assert.deepEqual(service.status(), { configured: true, base: 'http://ov.test:1933' })
  assert.equal(typeof service.find, 'function')
  assert.equal(typeof service.profile, 'function')

  const blank = mount({ host: '' })
  assert.deepEqual(blank.service.status(), { configured: false }, 'a blank host reports not configured')
  assert.equal(mount({ enabled: false }).service.status().configured, false, 'the master switch gates the service')

  dispose()
  console.log('case 2  ok  the openviking service is published and gated by host + master switch')
}

// ---------------------------------------------------------------------------
// Case 3 — find(): the request and the rendered rows.
// ---------------------------------------------------------------------------

{
  fetchCalls = []
  fetchImpl = async () => jsonResponse(MEMORY_BODY)
  const { service } = mount()
  const { text, count } = await service.find('我之前说过什么偏好？')

  assert.equal(count, 3, 'three entries survive dedupe of the four returned rows')
  assert.match(text, /相关记忆/, 'the recall marker opens the block')
  assert.match(text, /用户偏好深色主题/, 'the best match is present')
  assert.match(text, /项目使用 pnpm/)
  assert.equal((text.match(/viking:\/\/mem\/1/g) ?? []).length, 1, 'duplicate uris are collapsed')
  assert.ok(
    text.indexOf('viking://mem/1') < text.indexOf('viking://mem/2') &&
      text.indexOf('viking://mem/2') < text.indexOf('viking://mem/4'),
    'entries are rendered in descending score order',
  )
  assert.match(text, /score=0\.910/, 'scores print to three decimals')
  assert.ok(!text.includes('<user-reminder>'), 'wrapping is the injector\'s job, not the backend\'s')

  // A live abstract runs to ~1.6k characters, so the per-entry budget must be
  // generous — a small fixed cut would discard most of the memory.
  const prefix = '长记忆 '
  const kept = 'A'.repeat(1200 - prefix.length)
  assert.ok(text.includes(prefix + kept + '…'), 'a long abstract is cut exactly at abstractChars and marked')
  assert.ok(!text.includes(prefix + kept + 'A'), 'and not one character beyond it')
  assert.ok(!text.includes('结尾标记'), 'the cut really removes the tail')

  assert.equal(fetchCalls.length, 1, 'exactly one request per find')
  const call = fetchCalls[0]
  assert.equal(call.url, 'http://ov.test:1933/api/v1/search/find')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.headers.Authorization, 'Bearer test-token-123', 'the token comes from credentials')
  assert.equal(call.init.headers['X-OpenViking-User'], 'alice')
  assert.equal(call.init.headers['X-OpenViking-Account'], 'default')
  assert.equal(call.init.headers['X-OpenViking-Peer'], 'default')
  const body = JSON.parse(call.init.body)
  assert.equal(body.query, '我之前说过什么偏好？')
  assert.equal(body.score_threshold, 0.4)
  assert.equal(body.limit, 3)
  assert.ok(call.init.signal, 'the request carries an abort signal')

  console.log(
    text
      .split('\n')
      .slice(0, 4)
      .map((line) => '        ' + line)
      .join('\n'),
  )
  console.log('case 3  ok  find() issues one well-formed request and renders ordered rows')
}

// ---------------------------------------------------------------------------
// Case 4 — host and port are read independently, and typed values win.
// ---------------------------------------------------------------------------

{
  fetchCalls = []
  fetchImpl = async () => jsonResponse({ result: [] })
  const cases = [
    [{ host: 'https://ov.example.com:8443/' }, 'https://ov.example.com:8443/api/v1/search/find'],
    [{ host: '10.0.0.5', port: 1944 }, 'http://10.0.0.5:1944/api/v1/search/find'],
    [{ host: 'ov.example.com', port: 80, scheme: 'https' }, 'https://ov.example.com:80/api/v1/search/find'],
    [{ host: 'http://plain.local' }, 'http://plain.local:1933/api/v1/search/find'],
  ]
  for (const [overrides, expected] of cases) {
    fetchCalls = []
    const { service } = mount(overrides)
    await service.find('hi')
    assert.equal(fetchCalls[0]?.url, expected, `host/port resolution for ${JSON.stringify(overrides)}`)
  }
  console.log('case 4  ok  scheme and port resolve from the host, the port field, then the default')
}

// ---------------------------------------------------------------------------
// Case 5 — nothing configured or nothing to search: no request at all.
// ---------------------------------------------------------------------------

{
  fetchCalls = []
  const blank = mount({ host: '' })
  assert.deepEqual(await blank.service.find('hi'), { text: '', count: 0 })
  assert.equal(fetchCalls.length, 0, 'a blank host must not touch the network')

  const off = mount({ enabled: false })
  assert.deepEqual(await off.service.find('hi'), { text: '', count: 0 })
  assert.equal(fetchCalls.length, 0, 'a disabled plugin must not touch the network')

  const emptyQuery = mount()
  assert.deepEqual(await emptyQuery.service.find('   '), { text: '', count: 0 })
  assert.equal(fetchCalls.length, 0, 'an empty query is not sent')
  console.log('case 5  ok  blank host, disabled plugin, and empty query all short-circuit')
}

// ---------------------------------------------------------------------------
// Case 6 — an ordinary empty result is empty text, not an error.
// ---------------------------------------------------------------------------

{
  fetchCalls = []
  fetchImpl = async () => jsonResponse({ result: { memories: [] } })
  const { service, ctx } = mount()
  assert.deepEqual(await service.find('没有相关记忆'), { text: '', count: 0 })
  assert.equal(ctx.logs.length, 0, 'an empty result is not a failure and must not warn')
  console.log('case 6  ok  an empty result is silent')
}

// ---------------------------------------------------------------------------
// Case 7 — failures reject, so the caller decides how to degrade.
// ---------------------------------------------------------------------------

{
  const failures = [
    ['HTTP 401', async () => jsonResponse({ error: 'unauthorized' }, 401)],
    ['HTTP 500', async () => jsonResponse({}, 500)],
    [
      'unparseable body',
      async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('bad json')
        },
      }),
    ],
    [
      'network error',
      async () => {
        throw new Error('ECONNREFUSED')
      },
    ],
  ]
  for (const [label, impl] of failures) {
    fetchCalls = []
    fetchImpl = impl
    const { service } = mount()
    await assert.rejects(() => service.find('hi'), `${label}: find must reject`)
  }
  console.log('case 7  ok  transport and protocol failures reject instead of reading as "no memories"')
}

// ---------------------------------------------------------------------------
// Case 8 — a per-request deadline aborts the request itself.
// ---------------------------------------------------------------------------

{
  let requestSignal
  fetchImpl = async (_url, init) => {
    requestSignal = init.signal
    return new Promise((_resolve, reject) => {
      // `AbortSignal.timeout`'s timer is unref'd, so an otherwise idle loop
      // would exit before the deadline fires. Hold a ref'd timer instead.
      const keepAlive = setTimeout(() => reject(new Error('the deadline never fired')), 2000)
      init.signal.addEventListener('abort', () => {
        clearTimeout(keepAlive)
        reject(new Error('aborted by deadline'))
      })
    })
  }
  const { service } = mount({ timeoutMs: 40 })
  await assert.rejects(() => service.find('hi'))
  assert.ok(requestSignal, 'the request carries an abort signal')
  assert.equal(requestSignal.aborted, true, 'the deadline aborts the request itself')
  console.log('case 8  ok  timeoutMs bounds and aborts a recall request')
}

// ---------------------------------------------------------------------------
// Case 9 — profile(): the memory index, soft-failing per root.
// ---------------------------------------------------------------------------

{
  fetchCalls = []
  fetchImpl = async (url) => {
    assert.match(String(url), /\/api\/v1\/fs\/tree\?uri=/)
    return jsonResponse({ result: { entries: [{ name: '主题A' }, { title: '主题B' }] } })
  }
  const { service } = mount()
  const index = await service.profile()
  assert.equal(PROFILE_MARKER, '## 🧠 记忆索引')
  assert.match(index, /记忆索引/)
  assert.match(index, /- 主题A/)
  assert.match(index, /- 主题B/)
  assert.match(
    decodeURIComponent(fetchCalls[0].url),
    /viking:\/\/user\/alice\/peers\/default\/memories\//,
    'the peer root is probed first',
  )

  // No user → no addressable root.
  fetchCalls = []
  const anonymous = mount({ user: '' })
  assert.equal(await anonymous.service.profile(), '')
  assert.equal(fetchCalls.length, 0, 'a missing user name leaves nothing to address')

  // A failing tree endpoint is a soft failure: an empty index, no throw.
  fetchImpl = async () => {
    throw new Error('ECONNREFUSED')
  }
  assert.equal(await service.profile(), '', 'the index degrades to empty instead of throwing')
  console.log('case 9  ok  profile() reads the tree under the peer root and soft-fails')
}

// ---------------------------------------------------------------------------
// Case 10 — a live settings edit is observed without remounting.
// ---------------------------------------------------------------------------

{
  fetchCalls = []
  fetchImpl = async () => jsonResponse({ result: [] })
  const { service, config } = mount()
  await service.find('hi')
  assert.equal(JSON.parse(fetchCalls[0].init.body).limit, 3)

  if (typeof config.limit?.set === 'function') {
    config.limit.set(7)
    await service.find('hi again')
    assert.equal(
      JSON.parse(fetchCalls[1].init.body).limit,
      7,
      'configuration is read per query, so a settings edit applies without a restart',
    )
    console.log('case 10 ok  a live settings edit applies from the next query')
  } else {
    console.log('case 10 skip live-ref setter unavailable in this schemastery build')
  }
}

// ---------------------------------------------------------------------------
// Case 11 — the browser half registers the right page, keyed by the package.
// ---------------------------------------------------------------------------

{
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(source.startsWith('/**'), 'the bundle keeps its module documentation')

  let definition
  globalThis.window = {
    __ModuleLoader__: {
      load: (def) => {
        definition = def
      },
    },
  }
  await import('../lib/client.js')

  assert.ok(definition, 'the bundle must register through window.__ModuleLoader__.load')
  assert.equal(definition.id, 'dsh-openviking', 'the loader id must match the plugin name')
  assert.equal(typeof definition.factory, 'function')

  // Stand-ins for the modules the Client loader injects.
  const jsx = (type, props) => ({ type, props })
  const specs = {
    settingsTextField: (field) => ({
      field,
      format: (v) => (typeof v === 'string' ? v : ''),
      parse: (t) => ({ kind: 'set', value: t }),
    }),
    settingsNumberField: (field) => ({
      field,
      format: (v) => (typeof v === 'number' ? String(v) : ''),
      parse: (t) => ({ kind: 'set', value: Number(t) }),
    }),
  }
  class FakeFormModel {
    constructor(scope, fieldSpecs, secretSpecs = []) {
      this.specs = new Map(fieldSpecs.map((s) => [s.field, s]))
      this.secretSpecs = new Map(secretSpecs.map((s) => [s.field, s]))
      this.values = {}
    }
    bind(project) {
      this.project = project
      return { set: () => {}, get: () => this.project() }
    }
    shell() {
      return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
    }
    field(field) {
      const spec = this.specs.get(field)
      return { text: spec ? spec.format(this.values[field]) : '', overridden: false, invalid: false }
    }
    actions() {
      return { edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} }
    }
    dispose() {}
  }
  const primitives = {
    ...specs,
    Switch: 'Switch',
    SettingsForm: 'SettingsForm',
    SettingsValueField: 'SettingsValueField',
    SettingsSecretField: 'SettingsSecretField',
    SettingsFormModel: FakeFormModel,
  }
  const requireStub = (specifier) => {
    if (specifier === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require("${specifier}")`)
  }

  const clientExports = definition.factory(requireStub)
  assert.deepEqual(clientExports.inject, ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'])

  const registered = []
  const localeDicts = []
  const clientCtx = {
    effect: (fn) => {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    locale: {
      bind: () => (key) => key,
      register: (ns, dicts) => {
        localeDicts.push({ ns, dicts })
        return () => {}
      },
    },
    configForms: {
      get: (ns) => {
        assert.equal(ns, 'dsh-openviking')
        return {
          subscribe: () => () => {},
          getSnapshot: () => ({ status: 'ready', writable: true, value: {} }),
          set: () => {},
        }
      },
      whileServed: (keys, cb) => {
        assert.deepEqual(keys, ['dsh-openviking'])
        return cb()
      },
    },
    slots: {
      inject: (slotName, cb) => {
        assert.equal(slotName, 'plugins.bundle.config')
        return cb()
      },
      register: (entry, component) => {
        registered.push({ entry, component })
        return () => {}
      },
    },
    remote: {
      $on: () => () => {},
      credentials: {
        describe: async () => ({ ok: true, value: {} }),
        set: async () => {},
      },
    },
  }

  clientExports.apply(clientCtx)

  assert.equal(registered.length, 1, 'exactly one page registration')
  assert.equal(registered[0].entry.name, 'plugins.bundle.config')
  assert.equal(
    registered[0].entry.key,
    'dsh-openviking',
    'the slot key must be the bundle package name, or the page renders nothing',
  )
  assert.equal(registered[0].entry.locale, 'settings.openviking')
  assert.equal(typeof registered[0].entry.inject().hooks.injectSettingsCard, 'object')
  assert.equal(localeDicts.length, 1, 'the page owns its dictionary')
  assert.ok(localeDicts[0].dicts.en?.title && localeDicts[0].dicts.zh?.title, 'both locales are supplied')

  // The summary view is what the Plugins list shows before the card is opened.
  const summary = registered[0].component({
    view: 'summary',
    t: (key) => key,
    useOpenvikingSettingsCard: (select) => select({}),
  })
  assert.equal(typeof summary, 'string')

  // The card must expose the five settings the task names: host, port, key,
  // threshold, and hit count — plus the master switch.
  const empty = { text: '', overridden: false, invalid: false }
  const formState = {
    available: true,
    writable: true,
    dirty: false,
    enabled: true,
    host: empty,
    port: empty,
    scoreThreshold: empty,
    limit: empty,
    apiKey: empty,
    apiKeyConfigured: false,
    apiKeyWritable: true,
  }
  const tree = registered[0].component({
    view: 'form',
    t: (key) => key,
    useOpenvikingSettingsCard: (select) => select(formState),
    save: () => {},
    discard: () => {},
    edit: () => {},
    resetField: () => {},
  })
  const ids = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.props?.id) ids.push(node.props.id)
    for (const child of Array.isArray(node.props?.children) ? node.props.children : []) walk(child)
  }
  walk(tree)
  assert.deepEqual(
    ids,
    [
      'openviking-config-host',
      'openviking-config-port',
      'openviking-config-key',
      'openviking-config-score',
      'openviking-config-limit',
    ],
    'the card renders host, port, key, threshold, and hit count in order',
  )

  console.log('case 11 ok  browser half registers plugins.bundle.config with the five settings controls')
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

globalThis.fetch = realFetch
delete globalThis.window

console.log('\nall checks passed')
