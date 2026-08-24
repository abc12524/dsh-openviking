/**
 * The OpenViking card's staged form over the `openviking` settings namespace.
 *
 * Mirrors the harness's plugin-card form model (ui-settings-plugins'
 * card-form.ts) without importing it: the client bundle-purity gate rejects
 * value imports across plugins, so the card owns its own staging and
 * revision fencing. A field stages what the user types and a save writes
 * every staged edit through the revision-fenced settings scope; the Host is
 * the only authority on what it accepted, so a failed save keeps its drafts
 * instead of discarding them.
 */

import type {
  SettingsScope,
  SettingsScopeSnapshot,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { useSyncExternalStore } from 'react'

/** The openviking settings namespace, spelled here (client must not import host). */
export const OPENVIKING_NS = 'openviking'

/** The openviking settings namespace fields this card edits. */
export interface OpenVikingSectionValue {
  /** OpenViking REST server root of the memory server. */
  url?: string
  /** OpenViking user identity (informational; auth uses `key`). */
  user?: string
  /** Full bearer token (never echoed back after save). */
  key?: string
  /** Strictly-greater relevance threshold (0..1). */
  minScore?: number
  /** Maximum candidate memories injected per question. */
  maxResults?: number
}

/** Field names the card stages under. */
export type OpenVikingField = keyof OpenVikingSectionValue

/** One control's state as the card renders it. */
export interface OpenVikingFieldState {
  /** Draft text the control renders. */
  text: string
  /**
   * Whether the user layer carries this field — presence, not value, is
   * what marks a field overridden: an override equal to the composition
   * default is still an override.
   */
  overridden: boolean
  /** Whether the draft is not a value this field accepts, which blocks saving. */
  invalid: boolean
}

/** Card-level state shared with the chrome. */
export interface OpenVikingCardState {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
  /** Per-field control state. */
  fields: Record<OpenVikingField, OpenVikingFieldState>
  /**
   * The resolved user identity, rendered as a placeholder while the field is
   * unedited — the card never shows it as a value, so a save cannot surprise
   * the composition layer with an identity nobody chose.
   */
  userPlaceholder: string
}

/** The registration-side face the card's slot entry injects. */
export interface OpenVikingCardFace {
  /** Card snapshot bound by the renderer as useOpenVikingCard. */
  useOpenVikingCard: <R>(selector: (state: OpenVikingCardState) => R) => R
  /** Stage draft text for one field. */
  edit: (field: OpenVikingField, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  resetField: (field: OpenVikingField) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** One field's staged edit. */
type Staged = { kind: 'edit'; text: string } | { kind: 'clear' }

/** Field names validated as finite numbers. */
const NUMERIC_FIELDS: ReadonlySet<OpenVikingField> = new Set(['minScore', 'maxResults'])

/**
 * Bridges the `openviking` settings scope onto the card: stages edits,
 * writes them on save, and republishes whenever the scope or a draft moves.
 */
export class OpenVikingCardController {
  private readonly staged = new Map<OpenVikingField, Staged>()
  private readonly store: SnapshotStore<OpenVikingCardState>
  private readonly subscribe: (fn: () => void) => () => void
  private saving = false
  private failed = false

  /**
   * @param scope - the bound settings scope for the `openviking` namespace.
   */
  constructor(private readonly scope: SettingsScope<OpenVikingSectionValue>) {
    this.store = createSnapshotStore(this.projection())
    this.subscribe = this.store.subscribe.bind(this.store)
    scope.subscribe(() => { this.store.set(this.projection()) })
  }

  /** Build the face the card's slot registration injects. */
  inject(): OpenVikingCardFace {
    return {
      useOpenVikingCard: <R,>(selector: (state: OpenVikingCardState) => R): R =>
        useSyncExternalStore(this.subscribe, () => selector(this.store.getSnapshot())),
      edit: (field, text) => { this.stage(field, { kind: 'edit', text }) },
      resetField: (field) => { this.stage(field, { kind: 'clear' }) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  /** The whole-card state: what the Host serves, and what a save would do. */
  private projection(): OpenVikingCardState {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable === true,
      dirty: this.staged.size > 0,
      invalid: this.plan().some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
      fields: {
        url: this.field('url'),
        user: this.field('user'),
        key: this.field('key'),
        minScore: this.field('minScore'),
        maxResults: this.field('maxResults'),
      },
      userPlaceholder: this.snapshot().value?.user ?? 'default',
    }
  }

  /** One control's state: the user layer over the composition layer over the default. */
  private field(field: OpenVikingField): OpenVikingFieldState {
    const staged = this.staged.get(field)
    if (staged !== undefined) {
      if (staged.kind === 'clear') return { text: '', overridden: false, invalid: false }
      return {
        text: staged.text,
        overridden: true,
        invalid: NUMERIC_FIELDS.has(field) && !isFiniteNumber(staged.text),
      }
    }
    // The secret never rides a response and the current user renders as a
    // placeholder instead of a value, so both start blank.
    if (field === 'key' || field === 'user') {
      return { text: '', overridden: this.overridden(field), invalid: false }
    }
    const value = this.value(field)
    return {
      text: value === undefined ? '' : String(value),
      overridden: this.overridden(field),
      invalid: false,
    }
  }

  /** Whether the user layer carries the field (presence, not value). */
  private overridden(field: OpenVikingField): boolean {
    const user = this.snapshot().user as Record<string, unknown> | undefined
    return user !== undefined && Object.hasOwn(user, field)
  }

  /** The resolved value of one field. */
  private value(field: OpenVikingField): unknown {
    return (this.snapshot().value as Record<string, unknown> | undefined)?.[field]
  }

  private snapshot(): SettingsScopeSnapshot<OpenVikingSectionValue> {
    return this.scope.getSnapshot()
  }

  private stage(field: OpenVikingField, edit: Staged): void {
    this.failed = false
    this.staged.set(field, edit)
    this.store.set(this.projection())
  }

  private discard(): void {
    if (this.staged.size === 0 && !this.failed) return
    this.staged.clear()
    this.failed = false
    this.store.set(this.projection())
  }

  /**
   * Write every staged edit, then re-seed from what the Host accepted. A
   * save that did not land keeps its drafts so the user can correct them.
   */
  private async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run])
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.store.set(this.projection())
    let landed = true
    for (const write of writes) {
      try {
        await write()
      } catch (_writeFailure) {
        landed = false
      }
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.store.set(this.projection())
  }

  /**
   * Every staged edit a save would write; an entry whose draft is not a
   * value its field accepts carries no write — the form is still dirty, and
   * the save refuses rather than dropping the edit.
   */
  private plan(): Array<{ field: OpenVikingField; run: (() => Promise<void>) | undefined }> {
    const plan: Array<{ field: OpenVikingField; run: (() => Promise<void>) | undefined }> = []
    for (const [field, staged] of this.staged) {
      if (staged.kind === 'clear') {
        plan.push({ field, run: () => this.scope.unset(field) })
        continue
      }
      const raw = staged.text.trim()
      if (raw === '') {
        // Emptying the control is the same gesture as resetting it.
        plan.push({ field, run: () => this.scope.unset(field) })
        continue
      }
      if (NUMERIC_FIELDS.has(field)) {
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) {
          plan.push({ field, run: undefined })
          continue
        }
        plan.push({ field, run: () => this.scope.set(field, parsed) })
        continue
      }
      plan.push({ field, run: () => this.scope.set(field, raw) })
    }
    return plan
  }
}

/** Whether a draft parses as a finite number. */
function isFiniteNumber(text: string): boolean {
  return Number.isFinite(Number(text.trim()))
}
