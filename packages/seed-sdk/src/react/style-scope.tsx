import { createContext, useContext, type ReactNode } from 'react';
const PluginStyleScope = createContext<string | undefined>(undefined);

/** Scope for custom portals; the platform never interprets their business content. */
export function usePluginStyleScope() {
  return useContext(PluginStyleScope);
}

/** Scope shared component portals without supplying plugin business translations. */
export function ComponentProvider({ pluginId, children }: { pluginId?: string; children: ReactNode }) {
  return <PluginStyleScope.Provider value={pluginId}>{children}</PluginStyleScope.Provider>;
}
