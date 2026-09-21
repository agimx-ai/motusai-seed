import type { SeedPluginDetailPresentation } from '../../../shared/plugin-manifest'
import { resolveSeedLocalizedText } from '../../../shared/plugin-manifest'
import { useSeedI18n } from '../../i18n'
import { PluginRoutePresentation } from './PluginRoutePresentation'

export function PluginDetailPresentation({ presentation }: { presentation: SeedPluginDetailPresentation }) {
  const { locale } = useSeedI18n()
  return <PluginRoutePresentation
    nodes={presentation.nodes.map((node) => ({
      icon: node.icon,
      title: resolveSeedLocalizedText(node.title, locale),
      description: resolveSeedLocalizedText(node.description, locale),
    }))}
    summary={resolveSeedLocalizedText(presentation.summary, locale)}
  />
}
