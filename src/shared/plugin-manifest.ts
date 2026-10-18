import { z } from 'zod';
import { type SeedLocalizedText } from '@motus-ai/seed-sdk';

const identifier = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
export type { SeedLocalizedText } from '@motus-ai/seed-sdk';

export function seedLocalizedTextSchema(max: number) {
  const text = z.string().min(1).max(max);
  return z.object({ en_US: text, zh_Hans: text }).strict();
}

export function resolveSeedLocalizedText(value: SeedLocalizedText | undefined, locale: string, fallback = '') {
  if (!value) return fallback;
  return locale.toLowerCase().startsWith('en') ? value.en_US : value.zh_Hans;
}
export const seedPluginLabels = [
  'agimx',
  'search',
  'image',
  'videos',
  'weather',
  'finance',
  'design',
  'travel',
  'social',
  'news',
  'medical',
  'productivity',
  'education',
  'business',
  'entertainment',
  'utilities',
  'other',
] as const;
const seedPluginLabelSchema = z.enum(seedPluginLabels);
export const seedPluginLabelsSchema = z
  .array(seedPluginLabelSchema)
  .min(1)
  .max(3)
  .superRefine((labels, context) => {
    const seen = new Set<string>();
    for (const [index, label] of labels.entries()) {
      if (seen.has(label)) context.addIssue({ code: 'custom', path: [index], message: `重复的插件标签：${label}` });
      seen.add(label);
    }
  });
const seedConsumedCapabilityByIdSchema = z
  .object({
    capability: identifier,
    methods: z.array(identifier).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const methods = new Set<string>();
    for (const [index, method] of value.methods.entries()) {
      if (methods.has(method))
        context.addIssue({ code: 'custom', path: ['methods', index], message: `重复的方法：${method}` });
      methods.add(method);
    }
  });

const seedConsumedCapabilityByAnnotationSchema = z
  .object({
    match: z
      .object({
        method_annotation: identifier,
        equals: z.union([z.boolean(), z.number().finite(), z.string().min(1).max(256)]),
      })
      .strict(),
  })
  .strict();

export const seedConsumedCapabilitySchema = z.union([
  seedConsumedCapabilityByIdSchema,
  seedConsumedCapabilityByAnnotationSchema,
]);

export type SeedPluginLabel = z.infer<typeof seedPluginLabelSchema>;
export type SeedConsumedCapability = z.infer<typeof seedConsumedCapabilitySchema>;
export type SeedPluginManifest = {
  id: string;
  version: string;
  name: SeedLocalizedText;
  description: SeedLocalizedText;
  publisher: string;
  minSeedVersion: string;
  icon: string;
  iconDark?: string;
  runtime: { kind: 'sandboxed-web' | 'native-host' };
  permissions: string[];
  consumes: SeedConsumedCapability[];
  sidecars: Array<{ id: string; path: string; executable: true }>;
  jsonManifest: import('./plugin-json-manifest').SeedPluginJsonManifest;
  translations: import('@motus-ai/seed-sdk').PluginTranslations;
};
