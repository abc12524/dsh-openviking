/** OpenViking settings section copy: English and Chinese dictionaries. */

/** Dictionary key union for the OpenViking settings section. */
export type OpenVikingKey =
  | 'nav' | 'title' | 'intro' | 'unavailable'
  | 'url' | 'user' | 'key'
  | 'minScore' | 'minScoreHint'
  | 'maxResults' | 'maxResultsHint'
  | 'save' | 'saving' | 'discard' | 'saveFailed'

/** Chinese copy. */
export const zh: Record<OpenVikingKey, string> = {
  nav: 'OpenViking',
  title: 'OpenViking 记忆设置',
  intro: '连接 OpenViking 记忆服务器，在每次提问时自动检索候选记忆作为背景线索注入。',
  unavailable: '设置服务不可用。',
  url: '服务器地址 (MCP 端点)',
  user: '用户 (可选)',
  key: 'API Key',
  minScore: '相关性阈值',
  minScoreHint: '仅注入相关度大于该值(0-1)的候选记忆，默认 0.4。',
  maxResults: '搜索条数',
  maxResultsHint: '每次最多注入的候选记忆条数，默认 3。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '保存失败，请重试。',
}

/** English copy. */
export const en: Record<OpenVikingKey, string> = {
  nav: 'OpenViking',
  title: 'OpenViking Memory Settings',
  intro: 'Connect an OpenViking memory server and auto-inject candidate memories as background context on every question.',
  unavailable: 'Settings service unavailable.',
  url: 'Server URL (MCP endpoint)',
  user: 'User (optional)',
  key: 'API Key',
  minScore: 'Relevance threshold',
  minScoreHint: 'Only inject candidates with relevance above this value (0-1); default 0.4.',
  maxResults: 'Result count',
  maxResultsHint: 'Maximum candidate memories injected per question; default 3.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'Save failed; please retry.',
}
