/**
 * OpenViking `ov` tool series for DeepSeek Harness — the REST-backed port of
 * `OpenVikingTools.kt`. Each tool forwards to {@link OpenVikingRestClient} and
 * returns the server's response (or a `{"error": ...}` JSON string) as plain
 * text, matching the Kotlin tool contract.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { OpenVikingConfig } from './index'
import { OpenVikingRestClient, type OvConfig } from './ov-client'

/** Plain-text output: the tool returns the server response verbatim. */
const textOutput = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
} as const

/** Wrap a client call so failures surface as `{"error": ...}` text. */
async function safe(call: () => Promise<string>): Promise<string> {
  try {
    return await call()
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
  }
}

/** All `openviking_*` tool names, for visibility gating. */
export const OV_TOOL_NAMES = [
  'openviking_search',
  'openviking_remember',
  'openviking_read',
  'openviking_list_dir',
  'openviking_write_file',
  'openviking_create_session',
  'openviking_add_message',
  'openviking_commit_session',
  'openviking_delete_file',
] as const

/**
 * Register the nine `openviking_*` tools into the harness tool registry, and
 * return a `syncVisibility` callback that hides them from the model-facing
 * tool list (via `ctx.tools.restrict`) whenever the memory server is
 * unconfigured. Call it on every config change to keep disclosure live.
 * @param ctx - plugin context; the registrations are disposed with it.
 * @param getConfig - live config getter (url/key/user/timeoutMs).
 * @returns `syncVisibility`, to invoke when the resolved config changes.
 */
export function registerOvTools(ctx: Context, getConfig: () => OpenVikingConfig): () => void {
  const client = new OpenVikingRestClient((): OvConfig => {
    const c = getConfig()
    return { url: c.url, user: c.user, key: c.key, timeoutMs: c.timeoutMs }
  })

  ctx.tools.register(defineTool({
    name: 'openviking_search',
    description: '在 OpenViking 外置记忆中语义搜索，查找之前保存的知识、偏好、项目信息等',
    parameters: {
      query: { type: 'string', required: true, description: '搜索关键词，描述要查找什么内容' },
      limit: { type: 'number', description: '返回候选条数上限（默认 3，模型可覆盖）' },
      min_score: { type: 'number', description: '最低相关性分数阈值（0-1，默认 0.4，模型可覆盖）' },
    },
    output: textOutput,
    async execute(args) {
      const query = args.query as string
      const limit = typeof args.limit === 'number' ? args.limit : 3
      const minScore = typeof args.min_score === 'number' ? args.min_score : 0.4
      return safe(() => client.search(query, limit, minScore))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'openviking_remember',
    description: '将重要信息保存到 OpenViking 外置记忆中，以便后续对话回忆。适合保存：用户偏好、项目配置、关键决策、有用的操作经验',
    parameters: {
      category: {
        type: 'string',
        required: true,
        enum: ['preferences', 'entities', 'events', 'experiences'],
        description: '记忆分类：preferences=用户偏好, entities=项目/概念/人物, events=决策/里程碑, experiences=操作经验',
      },
      name: { type: 'string', required: true, description: '记忆名称/主题' },
      content: { type: 'string', required: true, description: '要保存的内容（Markdown 格式）' },
    },
    output: textOutput,
    async execute(args) {
      return safe(() => client.remember(
        args.category as string,
        args.name as string,
        args.content as string,
      ))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'openviking_read',
    description: '通过 URI 读取 OpenViking 记忆中的单个文件内容。URI 格式: viking://user/{user}/...',
    parameters: {
      uri: { type: 'string', required: true, description: '文件的完整 URI' },
    },
    output: textOutput,
    async execute(args) {
      return safe(() => client.readFile(args.uri as string))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'openviking_list_dir',
    description: '列出 OpenViking 指定目录下的所有文件和子目录，用于探索记忆结构或查找特定文件',
    parameters: {
      uri: { type: 'string', required: true, description: '目录 URI' },
      recursive: { type: 'boolean', description: '是否递归列出子目录（默认 false）' },
    },
    output: textOutput,
    async execute(args) {
      const recursive = args.recursive === true
      return safe(() => client.listDir(args.uri as string, recursive))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'openviking_write_file',
    description: '写入内容到 OpenViking 记忆文件。支持三种模式：create=创建新文件, replace=覆盖已有文件, append=追加内容',
    parameters: {
      uri: { type: 'string', required: true, description: '文件 URI' },
      content: { type: 'string', required: true, description: '要写入的内容（Markdown 格式）' },
      mode: {
        type: 'string',
        required: true,
        enum: ['create', 'replace', 'append'],
        description: '写入模式',
      },
    },
    output: textOutput,
    async execute(args) {
      return safe(() => client.writeFile(
        args.uri as string,
        args.content as string,
        args.mode as 'create' | 'replace' | 'append',
      ))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'openviking_create_session',
    description: '在 OpenViking 中创建一个新的对话 Session，用于保存一段完整的对话历史',
    parameters: {
      session_id: { type: 'string', description: '可选。自定义 session_id (UUID 格式)。不传则自动生成' },
    },
    output: textOutput,
    async execute(args) {
      const sessionId = typeof args.session_id === 'string' ? args.session_id : ''
      return safe(() => client.createSession(sessionId))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'openviking_add_message',
    description: '向 OpenViking Session 中添加一条消息（user 或 assistant）',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session ID' },
      role: { type: 'string', required: true, enum: ['user', 'assistant'], description: '消息角色' },
      content: { type: 'string', required: true, description: '消息内容' },
    },
    output: textOutput,
    async execute(args) {
      return safe(() => client.addMessage(
        args.session_id as string,
        args.role as string,
        args.content as string,
      ))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'openviking_commit_session',
    description: '提交/归档 OpenViking Session，触发从会话内容中提取结构化长期记忆。commit 之后不要再次 add_message',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session ID' },
      keep_recent_count: { type: 'number', description: '保留最近 N 条消息在活跃 session 中。0=归档所有消息（默认）' },
    },
    output: textOutput,
    async execute(args) {
      const keepRecent = typeof args.keep_recent_count === 'number' ? args.keep_recent_count : 0
      return safe(() => client.commitSession(args.session_id as string, keepRecent))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'openviking_delete_file',
    description: '通过 URI 删除 OpenViking 记忆中的文件。注意：此操作不可撤销！',
    parameters: {
      uri: { type: 'string', required: true, description: '要删除的文件 URI' },
    },
    output: textOutput,
    async execute(args) {
      return safe(() => client.deleteFile(args.uri as string))
    },
  }))

  // Progressive disclosure: hide the tools from the model until the memory
  // server is configured, so an unconfigured deployment does not advertise
  // `openviking_*` in its tool prompt. `restrict` keeps presentation, lookup
  // and dispatch aligned; dispose it to reveal the tools again.
  let restriction: (() => void) | undefined
  const syncVisibility = (): void => {
    const c = getConfig()
    const enabled = c.url.trim() !== '' && c.key.trim() !== ''
    if (enabled && restriction !== undefined) {
      restriction()
      restriction = undefined
    } else if (!enabled && restriction === undefined) {
      restriction = ctx.tools.restrict({ deny: [...OV_TOOL_NAMES] })
    }
  }
  syncVisibility()
  return syncVisibility
}
