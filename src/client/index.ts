/**
 * OpenViking settings plugin, browser half: registers the OpenViking card on
 * the Web Settings plugin-configuration surface over the `openviking` settings
 * namespace (`settings.plugin.item`, keyed by namespace).
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the keyed slot's declaration lives with its declarer; a value
// import would fail the client bundle-purity gate.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { OpenVikingCardFace } from './openviking-card-controller.ts'
import {
  OPENVIKING_NS,
  OpenVikingCardController,
  type OpenVikingSectionValue,
} from './openviking-card-controller.ts'
import { OpenVikingCard } from './OpenVikingCard.tsx'
import { en, zh, type OpenVikingKey } from './locales.ts'

export {
  OpenVikingCardController,
  type OpenVikingCardFace,
  type OpenVikingCardState,
  type OpenVikingField,
  type OpenVikingFieldState,
  type OpenVikingSectionValue,
} from './openviking-card-controller.ts'
export { OpenVikingCard, type OpenVikingCardProps } from './OpenVikingCard.tsx'
export type { OpenVikingKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The OpenViking card copy. */
    'settings.openviking': OpenVikingKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.openviking'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/**
 * Register the OpenViking card on the keyed `settings.plugin.item` slot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-openviking: dictionaries')

  // Bind the openviking namespace scope on this fiber; writes land live.
  const scope = ctx.settingsScope.bind<OpenVikingSectionValue>({ namespace: OPENVIKING_NS })
  const controller = new OpenVikingCardController(scope)
  const face = (): OpenVikingCardFace => controller.inject()

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: OPENVIKING_NS,
      locale: NS,
      inject: face,
    }, OpenVikingCard)
  })
}
