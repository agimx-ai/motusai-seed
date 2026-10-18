import { z } from 'zod';
import { createPluginI18n, type CapabilityDefinition, type PluginTranslations } from '@motus-ai/seed-sdk';
import type { CapsPluginDescriptor, SeedPluginRuntimeDefinition } from './contracts';
import { validatePluginBillingMetadata } from './plugin-billing-metadata';
import { seedLocalizedTextSchema } from './plugin-manifest';

export function pluginConsumesMethod(
  consumer: Pick<SeedPluginRuntimeDefinition, 'consumes'>,
  capability: CapsPluginDescriptor,
  method: CapsPluginDescriptor['methods'][number],
) {
  return (
    capability.exposure !== 'local' &&
    consumer.consumes.some((declaration) =>
      'capability' in declaration
        ? declaration.capability === capability.id && declaration.methods.includes(method.name)
        : method.annotations?.[declaration.match.method_annotation] === declaration.match.equals,
    )
  );
}

const identifier = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const translationKey = z.string().min(1).max(512);
const schema = z
  .record(z.string(), z.json())
  .refine(
    (value) => JSON.stringify(value).length <= 65_536 && value.$async !== true,
    'Invalid synchronous JSON Schema.',
  );
const method = z
  .object({
    name: identifier,
    displayNameKey: translationKey.optional(),
    descriptionKey: translationKey.optional(),
    platforms: z
      .array(z.enum(['darwin', 'linux', 'win32']))
      .min(1)
      .max(3)
      .optional(),
    risk: z.enum(['read', 'write', 'control']),
    inputSchema: schema.optional(),
    outputSchema: schema.optional(),
    annotations: z.record(identifier, z.json()).optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    validatePluginBillingMetadata(entry.annotations ?? {}, (path, message) =>
      context.addIssue({ code: 'custom', path, message }),
    );
  });

export const pluginCapabilitySchema = z
  .object({
    id: identifier,
    version: z.number().int().positive(),
    exposure: z.enum(['terminal', 'plugin', 'local']).optional(),
    descriptionKey: translationKey.optional(),
    annotations: z.record(identifier, z.json()).optional(),
    methods: z.array(method).min(1).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    if (JSON.stringify(value).length > 2 * 1024 * 1024)
      context.addIssue({ code: 'custom', message: 'Capability registration exceeds size limit.' });
    const names = new Set<string>();
    for (const [index, entry] of value.methods.entries()) {
      if (names.has(entry.name))
        context.addIssue({ code: 'custom', path: ['methods', index, 'name'], message: 'Duplicate capability method.' });
      names.add(entry.name);
      for (const prefix of ['agent', 'mcp']) {
        if (entry.annotations?.[`${prefix}.tool`] !== true) continue;
        // Agent consumers derive their own default tool name from capability + method.
        // Only an explicit alias is a tool name here; dotted public method IDs remain valid.
        if (prefix === 'agent' && entry.annotations['agent.tool_name'] === undefined) continue;
        const name = entry.annotations[`${prefix}.tool_name`] ?? entry.name;
        if (typeof name !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(name))
          context.addIssue({ code: 'custom', path: ['methods', index, 'annotations'], message: 'Invalid tool name.' });
        if (prefix === 'mcp' && (!entry.descriptionKey || entry.inputSchema?.type !== 'object'))
          context.addIssue({
            code: 'custom',
            path: ['methods', index],
            message: 'MCP tools need a description and an object input schema.',
          });
      }
    }
  });

/** Adapt only at the existing public protocol boundary; no manifest or view interpreter. */
export function capabilityProtocolDescriptor(
  definition: CapabilityDefinition,
  translations?: PluginTranslations,
): CapsPluginDescriptor {
  const instances = {
    en_US: createPluginI18n(translations, 'en-US'),
    zh_Hans: createPluginI18n(translations, 'zh-CN'),
  };
  const text = (key: string, maximum: number) => {
    if (!instances.en_US.exists(key)) throw new Error('Missing capability translation: ' + key);
    return seedLocalizedTextSchema(maximum)
      .refine((value) => Boolean(value.en_US.trim() && value.zh_Hans.trim()), 'Capability text cannot be blank.')
      .parse({ en_US: instances.en_US.t(key), zh_Hans: instances.zh_Hans.t(key) });
  };
  const errors = instances.en_US.getResource(
    instances.en_US.language,
    'translation',
    'capabilities.' + definition.id + '.errors',
  );
  const localizedErrors =
    errors && typeof errors === 'object'
      ? Object.fromEntries(
          Object.keys(errors).map((code) => [
            code,
            Object.fromEntries(
              Object.entries(instances).map(([locale, instance]) => [
                locale,
                instance
                  .t('capabilities.' + definition.id + '.errors.' + code, { skipInterpolation: true })
                  .replace(/\{\{([a-z][a-z0-9_.-]*)\}\}/g, '{$1}'),
              ]),
            ),
          ]),
        )
      : {};
  return {
    id: definition.id,
    version: definition.version,
    exposure: definition.exposure ?? 'terminal',
    ...(definition.descriptionKey ? { description: text(definition.descriptionKey, 1_000) } : {}),
    annotations: definition.annotations ?? {},
    ...(Object.keys(localizedErrors).length
      ? { errors: localizedErrors as Record<string, { en_US: string; zh_Hans: string }> }
      : {}),
    methods: definition.methods.map(({ displayNameKey, descriptionKey, ...entry }) => ({
      ...entry,
      ...(displayNameKey ? { display_name: text(displayNameKey, 100) } : {}),
      ...(descriptionKey ? { description: text(descriptionKey, 500) } : {}),
      annotations: entry.annotations ?? {},
    })),
  };
}
