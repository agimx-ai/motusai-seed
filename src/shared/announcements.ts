import { z } from 'zod';

const localized = (max: number, required = true) =>
  z.object({
    'zh-CN': z
      .string()
      .trim()
      .min(required ? 1 : 0)
      .max(max),
    'en-US': z
      .string()
      .trim()
      .min(required ? 1 : 0)
      .max(max),
  });
const announcementCopySchema = z
  .object({
    id: z.uuid(),
    title: localized(100),
    description: localized(600),
    button_label: localized(60, false),
    dismiss_label: localized(60),
    action: z
      .discriminatedUnion('kind', [
        z.object({
          kind: z.literal('plugin'),
          plugin_id: z
            .string()
            .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)
            .max(160),
        }),
        z.object({
          kind: z.literal('url'),
          url: z
            .url()
            .max(2048)
            .refine((value) => {
              const url = new URL(value);
              return url.protocol === 'https:' && !url.username && !url.password;
            }),
        }),
      ])
      .nullable(),
  })
  .superRefine((content, context) => {
    if (content.action)
      for (const locale of ['zh-CN', 'en-US'] as const) {
        if (!content.button_label[locale])
          context.addIssue({
            code: 'custom',
            path: ['button_label', locale],
            message: 'Button label is required for an action',
          });
      }
  });
const imageAnnouncementSchema = announcementCopySchema.safeExtend({
  template: z.enum(['immersive', 'image-above']).default('immersive'),
  background_url: z.url(),
  background_type: z.literal('image').optional(),
});
const textAnnouncementSchema = announcementCopySchema.safeExtend({
  background_type: z.literal('text'),
  description: localized(20_000),
});
export const announcementSchema = z.union([
  z.object({
    id: z.uuid(),
    background_type: z.literal('video'),
    background_url: z.url(),
    poster_url: z.url().optional(),
  }),
  textAnnouncementSchema,
  imageAnnouncementSchema,
]);
export const announcementPageSchema = z.object({
  items: z.array(announcementSchema).max(100),
  next_cursor: z.string().regex(/^\d+$/).nullable(),
});
export type SeedAnnouncement = z.infer<typeof announcementSchema>;
