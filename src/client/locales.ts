/** OpenViking settings card copy: English and Chinese dictionaries. */

/** Dictionary key union for the OpenViking card. */
export type OpenVikingKey =
  | 'title' | 'intro'
  | 'unsaved' | 'readOnly'
  | 'url' | 'user' | 'key'
  | 'minScore' | 'minScoreHint'
  | 'maxResults' | 'maxResultsHint'
  | 'overridden' | 'reset' | 'invalidNumber'
  | 'save' | 'saving' | 'discard' | 'saveFailed'

/** Chinese copy. */
export const zh: Record<OpenVikingKey, string> = {
  title: 'OpenViking 记忆',
  intro: '连接 OpenViking 记忆服务器，在每次提问时自动检索候选记忆作为背景线索注入。',
  unsaved: '未保存',
  readOnly: '本部署的设置为只读。',
  url: '服务器地址 (MCP 端点)',
  user: '用户 (可选)',
  key: 'API Key',
  minScore: '相关性阈值',
  minScoreHint: '仅注入相关度大于该值(0-1)的候选记忆，默认 0.4。',
  maxResults: '搜索条数',
  maxResultsHint: '每次最多注入的候选记忆条数，默认 3。',
  overridden: '已覆盖',
  reset: '重置',
  invalidNumber: '请填数字；留空表示使用默认值。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '保存失败，请重试。',
}

/** English copy. */
export const en: Record<OpenVikingKey, string> = {
  title: 'OpenViking Memory',
  intro: 'Connect an OpenViking memory server and auto-inject candidate memories as background context on every question.',
  unsaved: 'Unsaved',
  readOnly: 'This deployment stores settings read-only.',
  url: 'Server URL (MCP endpoint)',
  user: 'User (optional)',
  key: 'API Key',
  minScore: 'Relevance threshold',
  minScoreHint: 'Only inject candidates with relevance above this value (0-1); default 0.4.',
  maxResults: 'Result count',
  maxResultsHint: 'Maximum candidate memories injected per question; default 3.',
  overridden: 'Overridden',
  reset: 'Reset',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'Save failed; please retry.',
}
