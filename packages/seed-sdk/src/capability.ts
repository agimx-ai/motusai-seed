import { createPluginI18n, type PluginTranslations } from './i18n.js';
import type { SeedCapabilityHandler, SeedCapabilityRisk } from './index.js';

/** A public function registered by plugin code, not a UI declaration. */
export type CapabilityMethod = {
  name: string;
  displayNameKey?: string;
  descriptionKey?: string;
  platforms?: Array<'darwin' | 'linux' | 'win32'>;
  risk: SeedCapabilityRisk;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type CapabilityDefinition = {
  id: string;
  version: number;
  exposure?: 'terminal' | 'plugin' | 'local';
  descriptionKey?: string;
  annotations?: Record<string, unknown>;
  methods: CapabilityMethod[];
};

export type CapabilityRegistration = (
  definition: CapabilityDefinition,
  handler: SeedCapabilityHandler,
) => () => void | Promise<void>;

/** Build-time public protocol metadata. This does not load a backend or interpret a view schema. */
export function capabilityPackageMetadata(definitions: CapabilityDefinition[], translations: PluginTranslations) {
  const i18n = createPluginI18n(translations);
  const text = (key: string) =>
    Object.fromEntries(
      [
        ['en_US', 'en-US'],
        ['zh_Hans', 'zh-CN'],
      ].map(([field, lng]) => [
        field,
        i18n.t(key, { lng, skipInterpolation: true }).replace(/\{\{([a-z][a-z0-9_.-]*)\}\}/g, '{$1}'),
      ]),
    );
  return definitions.map(({ descriptionKey, methods, ...definition }) => ({
    ...definition,
    ...(descriptionKey ? { description: text(descriptionKey) } : {}),
    ...(i18n.getResource(translations.defaultLocale, 'translation', `capabilities.${definition.id}.errors`)
      ? {
          errors: Object.fromEntries(
            Object.keys(
              i18n.getResource(translations.defaultLocale, 'translation', `capabilities.${definition.id}.errors`),
            ).map((key) => [key, text(`capabilities.${definition.id}.errors.${key}`)]),
          ),
        }
      : {}),
    methods: methods.map(({ displayNameKey, descriptionKey, inputSchema, outputSchema, ...method }) => ({
      ...method,
      ...(displayNameKey ? { display_name: text(displayNameKey) } : {}),
      ...(descriptionKey ? { description: text(descriptionKey) } : {}),
      ...(inputSchema ? { input_schema: inputSchema } : {}),
      ...(outputSchema ? { output_schema: outputSchema } : {}),
    })),
  }));
}
