/**
 * OpenViking settings card, browser half: renders the OpenViking card inside
 * the Web Settings plugin-configuration surface and edits the `openviking`
 * settings namespace.
 *
 * The card draws its own chrome — a disclosure header naming the plugin and
 * what its settings govern, an unsaved badge while edits are staged, a
 * read-only banner, and a save/discard footer — because the bundle-purity
 * gate rejects value imports of the shipped card chrome across plugins. It
 * renders nothing while the namespace is unavailable, so a deployment that
 * does not serve it shows no trace of the card.
 *
 * Fields: server URL, user, key (secret), relevance threshold (minScore), and
 * result count (maxResults). The threshold/count drive the automatic
 * memory-context injection; edits land live via the settings namespace.
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the keyed slot's declaration lives with its declarer. A value
// import would fail the client bundle-purity gate.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {
  OpenVikingCardFace,
  OpenVikingField,
  OpenVikingFieldState,
} from './openviking-card-controller.ts'

/** Props the renderer binds for the OpenViking card. */
export type OpenVikingCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.openviking'>
  & InjectFace<OpenVikingCardFace>

/** Theme tokens (fallbacks keep the card legible off the settings shell). */
const TOKEN = {
  label: 'var(--dsw-alias-label-primary, #111)',
  labelTertiary: 'var(--dsw-alias-label-tertiary, #888)',
  border: 'var(--dsw-alias-border-l2, #ddd)',
  error: 'var(--dsw-alias-label-error, #d33)',
  bgLayer3: 'var(--dsw-alias-bg-layer-3, #fff)',
  brand: 'var(--dsw-alias-brand-primary, #1677ff)',
} as const

/** Render one field row with label, override badge, and reset. */
function Field({
  id, label, hint, state, secret, placeholder, disabled, overriddenLabel, resetLabel, invalidLabel, onEdit, onReset,
}: {
  id: string
  label: string
  hint?: string
  state: OpenVikingFieldState
  secret?: boolean
  placeholder?: string
  disabled: boolean
  overriddenLabel: string
  resetLabel: string
  invalidLabel: string
  onEdit: (text: string) => void
  onReset: () => void
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: TOKEN.label }}>{label}</label>
        {state.overridden
          ? (
            <button
              type="button"
              onClick={onReset}
              disabled={disabled}
              title={resetLabel}
              style={{
                fontSize: 11, padding: '1px 8px', borderRadius: 999, cursor: disabled ? 'default' : 'pointer',
                background: 'transparent', border: `1px solid ${TOKEN.border}`, color: TOKEN.labelTertiary,
              }}
            >
              {overriddenLabel}
            </button>
          )
          : null}
      </div>
      <input
        id={id}
        type={secret === true ? 'password' : 'text'}
        value={state.text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={event => onEdit(event.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: 13,
          border: `1px solid ${state.invalid ? TOKEN.error : TOKEN.border}`,
          borderRadius: 8, background: TOKEN.bgLayer3, color: TOKEN.label,
        }}
      />
      {state.invalid
        ? <span style={{ display: 'block', fontSize: 12, color: TOKEN.error, marginTop: 4 }}>{invalidLabel}</span>
        : null}
      {hint !== undefined
        ? <span style={{ display: 'block', fontSize: 12, color: TOKEN.labelTertiary, marginTop: 4 }}>{hint}</span>
        : null}
    </div>
  )
}

/** Render the OpenViking card. */
export function OpenVikingCard({ t, ...props }: OpenVikingCardProps) {
  const state = props.useOpenVikingCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null

  const blocked = !state.dirty || state.invalid || state.saving
  const disabled = !state.writable
  const field = (name: OpenVikingField) => state.fields[name]

  return (
    <li style={{ listStyle: 'none', border: `1px solid ${TOKEN.border}`, borderRadius: 12, background: TOKEN.bgLayer3, overflow: 'hidden' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 14px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: TOKEN.label }}>{t('title')}</span>
          <span style={{ fontSize: 12, color: TOKEN.labelTertiary }}>{t('intro')}</span>
        </span>
        {state.dirty ? <span style={{ fontSize: 11, color: TOKEN.brand }}>{t('unsaved')}</span> : null}
        <span style={{
          fontSize: 12, color: TOKEN.labelTertiary, transition: 'transform 120ms ease',
          transform: open ? 'rotate(180deg)' : 'none',
        }}
        >
          ▾
        </span>
      </button>
      {open
        ? (
          <div style={{ padding: '0 14px 14px' }}>
            {!state.writable ? <p role="status" style={{ fontSize: 12, color: TOKEN.labelTertiary, margin: '0 0 10px' }}>{t('readOnly')}</p> : null}
            <Field
              id="openviking-url" label={t('url')} state={field('url')} disabled={disabled}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
              onEdit={text => props.edit('url', text)} onReset={() => props.resetField('url')}
            />
            <Field
              id="openviking-user" label={t('user')} state={field('user')} disabled={disabled}
              placeholder={state.userPlaceholder}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
              onEdit={text => props.edit('user', text)} onReset={() => props.resetField('user')}
            />
            <Field
              id="openviking-key" label={t('key')} state={field('key')} secret disabled={disabled} placeholder="••••••"
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
              onEdit={text => props.edit('key', text)} onReset={() => props.resetField('key')}
            />
            <Field
              id="openviking-minScore" label={t('minScore')} hint={t('minScoreHint')} state={field('minScore')} disabled={disabled}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
              onEdit={text => props.edit('minScore', text)} onReset={() => props.resetField('minScore')}
            />
            <Field
              id="openviking-maxResults" label={t('maxResults')} hint={t('maxResultsHint')} state={field('maxResults')} disabled={disabled}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
              onEdit={text => props.edit('maxResults', text)} onReset={() => props.resetField('maxResults')}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              {state.failed ? <p role="status" style={{ fontSize: 12, color: TOKEN.error, margin: 'auto 12px auto 0' }}>{t('saveFailed')}</p> : null}
              <button
                type="button"
                disabled={!state.dirty || state.saving}
                onClick={props.discard}
                style={{
                  padding: '6px 16px', borderRadius: 8, fontSize: 13, cursor: state.dirty && !state.saving ? 'pointer' : 'default',
                  background: 'transparent', border: `1px solid ${TOKEN.border}`, color: TOKEN.label,
                }}
              >
                {t('discard')}
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={props.save}
                style={{
                  padding: '6px 16px', borderRadius: 8, fontSize: 13, cursor: blocked ? 'default' : 'pointer',
                  background: TOKEN.brand, color: '#fff', border: 'none',
                }}
              >
                {t(state.saving ? 'saving' : 'save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
