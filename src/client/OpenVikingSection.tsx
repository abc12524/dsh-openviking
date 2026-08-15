/**
 * OpenViking settings form, browser half: renders the OpenViking section on
 * the Web Settings page and edits the `openviking` settings namespace.
 *
 * Fields: server URL, user, key (secret), relevance threshold (minScore), and
 * result count (maxResults). The threshold/count drive the automatic
 * memory-context injection; edits land live via the settings namespace.
 */

import { useId, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

/** The openviking settings namespace, spelled here (client must not import host). */
export const OPENVIKING_NS = 'openviking'

/** The OpenViking section fields this form edits. */
export interface OpenVikingSectionValue {
  /** MCP Streamable HTTP endpoint of the memory server. */
  url?: string
  /** OpenViking user identity (informational). */
  user?: string
  /** Full bearer token (never echoed back after save). */
  key?: string
  /** Strictly-greater relevance threshold (0..1). */
  minScore?: number
  /** Maximum candidate memories injected per question. */
  maxResults?: number
}

/** Registration-side business face for the section: the bound scope. */
export interface OpenVikingSectionInjected {
  /** Bound settings scope for the openviking namespace. */
  scope: SettingsScope<OpenVikingSectionValue>
}

/** Props the renderer binds for the section. */
export type OpenVikingSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.openviking'>
  & InjectFace<OpenVikingSectionInjected>

/** Draft state of one staged edit. */
type Draft = { kind: 'edit'; text: string } | { kind: 'clear' }

/** Local staged drafts for the form; committed only on save. */
interface Drafts {
  url: Draft | undefined
  user: Draft | undefined
  key: Draft | undefined
  minScore: Draft | undefined
  maxResults: Draft | undefined
}

/** Render one text field row with label, input, and reset. */
function Field({
  id, label, hint, value, onChange, secret, invalid,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (text: string) => void
  secret?: boolean
  invalid?: boolean
}) {
  return (
    <label htmlFor={id} style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{label}</span>
      <input
        id={id}
        type={secret === true ? 'password' : 'text'}
        value={value}
        onChange={event => onChange(event.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: 13,
          border: `1px solid ${invalid === true ? 'var(--dsw-alias-label-error, #d33)' : 'var(--dsw-alias-border-l2, #ddd)'}`,
          borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3, #fff)',
          color: 'var(--dsw-alias-label-primary, #111)',
        }}
      />
      {hint !== undefined && <span style={{ display: 'block', fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: 4 }}>{hint}</span>}
    </label>
  )
}

/** Render the OpenViking settings section. */
export function OpenVikingSection({ t, scope }: OpenVikingSectionProps) {
  const inputId = useId()
  const snapshot = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const served = snapshot.status === 'ready'
  const value = snapshot.value as OpenVikingSectionValue | undefined
  const [drafts, setDrafts] = useState<Drafts>({ url: undefined, user: undefined, key: undefined, minScore: undefined, maxResults: undefined })
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const fieldText = (field: keyof Drafts, draft: Draft | undefined): string => {
    if (draft === undefined) {
      if (field === 'key') return '' // never echo the secret
      const stored = value?.[field as keyof OpenVikingSectionValue]
      return stored === undefined ? '' : String(stored)
    }
    return draft.kind === 'edit' ? draft.text : ''
  }
  const edit = (field: keyof Drafts, text: string): void => {
    setFailed(false)
    setDrafts(previous => ({ ...previous, [field]: { kind: 'edit', text } }))
  }
  const reset = (field: keyof Drafts): void => {
    setFailed(false)
    setDrafts(previous => ({ ...previous, [field]: { kind: 'clear' } }))
  }
  const dirty = Object.values(drafts).some(draft => draft !== undefined)

  const parseNumber = (text: string): number | undefined => {
    const parsed = Number(text.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const save = (): void => {
    if (saving) return
    setSaving(true)
    setFailed(false)
    const ops: Array<{ field: string; value?: unknown; unset: boolean }> = []
    const apply = (field: keyof Drafts, draft: Draft | undefined, toNumber = false): void => {
      if (draft === undefined) return
      if (draft.kind === 'clear') {
        ops.push({ field, unset: true })
        return
      }
      const raw = draft.text.trim()
      if (raw === '') {
        ops.push({ field, unset: true })
        return
      }
      const parsed = toNumber ? parseNumber(raw) : raw
      if (toNumber && parsed === undefined) return // invalid number: skip (field shows error)
      ops.push({ field, value: toNumber ? parsed : raw, unset: false })
    }
    apply('url', drafts.url)
    apply('user', drafts.user)
    apply('key', drafts.key)
    apply('minScore', drafts.minScore, true)
    apply('maxResults', drafts.maxResults, true)
    Promise.all(ops.map(op => op.unset ? scope.unset(op.field) : scope.set(op.field, op.value))).then(() => {
      setDrafts({ url: undefined, user: undefined, key: undefined, minScore: undefined, maxResults: undefined })
      setSaving(false)
    }).catch(() => {
      setFailed(true)
      setSaving(false)
    })
  }

  return (
    <div>
      <h2>{t('title')}</h2>
      <p style={{ color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 13 }}>{t('intro')}</p>

      {!served && <p style={{ color: 'var(--dsw-alias-label-error, #d33)' }}>{t('unavailable')}</p>}

      <Field id={`${inputId}-url`} label={t('url')} value={fieldText('url', drafts.url)} onChange={text => edit('url', text)} />
      <Field id={`${inputId}-user`} label={t('user')} value={fieldText('user', drafts.user)} onChange={text => edit('user', text)} />
      <Field id={`${inputId}-key`} label={t('key')} secret value={fieldText('key', drafts.key)} onChange={text => edit('key', text)} />
      <Field id={`${inputId}-minScore`} label={t('minScore')} hint={t('minScoreHint')} value={fieldText('minScore', drafts.minScore)} onChange={text => edit('minScore', text)} invalid={drafts.minScore?.kind === 'edit' && parseNumber(drafts.minScore.text) === undefined} />
      <Field id={`${inputId}-maxResults`} label={t('maxResults')} hint={t('maxResultsHint')} value={fieldText('maxResults', drafts.maxResults)} onChange={text => edit('maxResults', text)} invalid={drafts.maxResults?.kind === 'edit' && parseNumber(drafts.maxResults.text) === undefined} />

      {failed && <p style={{ color: 'var(--dsw-alias-label-error, #d33)', fontSize: 12 }}>{t('saveFailed')}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" disabled={!dirty || saving} onClick={save} style={{ padding: '6px 16px', borderRadius: 8, background: 'var(--dsw-alias-brand-primary, #1677ff)', color: '#fff', border: 'none', fontSize: 13 }}>
          {saving ? t('saving') : t('save')}
        </button>
        <button type="button" disabled={!dirty || saving} onClick={() => setDrafts({ url: undefined, user: undefined, key: undefined, minScore: undefined, maxResults: undefined })} style={{ padding: '6px 16px', borderRadius: 8, background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #ddd)', fontSize: 13 }}>
          {t('discard')}
        </button>
      </div>
    </div>
  )
}
