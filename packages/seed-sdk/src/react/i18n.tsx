import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useTranslation as useI18nextTranslation } from 'react-i18next';
import { createPluginI18n, type PluginTranslations } from '../i18n';
import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';

const resources: PluginTranslations = { defaultLocale: 'en-US', resources: { 'en-US': enUS, 'zh-CN': zhCN } };
const DefaultInstance = createPluginI18n(resources);
const ComponentTranslations = createContext(DefaultInstance);
const PluginStyleScope = createContext<string | undefined>(undefined);

/** Scope for custom portals; the platform never interprets their business content. */
export function usePluginStyleScope() {
  return useContext(PluginStyleScope);
}

/** SDK strings have their own scope and never override the plugin's react-i18next provider. */
export function ComponentProvider({
  locale,
  pluginId,
  children,
}: {
  locale: string;
  pluginId?: string;
  children: ReactNode;
}) {
  const instance = useMemo(() => createPluginI18n(resources, locale), [locale]);
  return (
    <ComponentTranslations.Provider value={instance}>
      <PluginStyleScope.Provider value={pluginId}>{children}</PluginStyleScope.Provider>
    </ComponentTranslations.Provider>
  );
}

export function useTranslation() {
  const instance = useContext(ComponentTranslations);
  return useI18nextTranslation('translation', { i18n: instance });
}
