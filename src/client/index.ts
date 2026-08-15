/**
 * OpenViking settings plugin, browser half: registers the OpenViking section
 * on the Web Settings page over the `openviking` settings namespace.
 *
 * The section is registered as a `settings.section` list entry (id
 * `openviking`), the same mechanism the shipped settings pages use, so it
 * appears in the Settings sidebar navigation without touching the shell.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { OpenVikingSection } from './OpenVikingSection.tsx'
import { OPENVIKING_NS, type OpenVikingSectionInjected, type OpenVikingSectionValue } from './OpenVikingSection.tsx'
import { en, zh, type OpenVikingKey } from './locales.ts'

export type { OpenVikingSectionInjected, OpenVikingSectionProps, OpenVikingSectionValue } from './OpenVikingSection.tsx'
export { OPENVIKING_NS } from './OpenVikingSection.tsx'
export type { OpenVikingKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The OpenViking settings section copy. */
    'settings.openviking': OpenVikingKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.openviking'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/**
 * Register the OpenViking settings section once the `settings.section`
 * declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-openviking: dictionaries')
  const t = ctx.locale.bind(NS)

  // Bind the openviking namespace scope on this fiber; writes land live.
  const scope = ctx.settingsScope.bind<OpenVikingSectionValue>({ namespace: OPENVIKING_NS })

  const injected = (): OpenVikingSectionInjected => ({
    scope,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'openviking',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, OpenVikingSection))
}
