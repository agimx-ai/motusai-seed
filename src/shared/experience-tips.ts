import { z } from 'zod';

export const experienceTipsLocalPath = '/v1/experience-tips';
export const experienceTipsLocalScope = 'seed:experience-tips';
export const experienceTipsObsidianClient = 'com.motusai.obsidian';
export const experienceTipsObsidianOrigin = 'app://obsidian.md';
export const experienceTipsBodyLimit = 1_048_576;

export const experienceTipWriteSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account') }),
  z.object({ kind: z.literal('themes') }),
  z.object({ kind: z.literal('prepare'), body: z.record(z.string(), z.json()) }),
  z.object({ kind: z.literal('submit'), tipId: z.uuid(), versionId: z.uuid(), body: z.object({ user_id: z.uuid() }).strict() }),
]);
export type ExperienceTipWrite = z.infer<typeof experienceTipWriteSchema>;

const experienceTipSortSchema = z.enum(['latest', 'popular']);
export type ExperienceTipSort = z.infer<typeof experienceTipSortSchema>;
const experienceTipCursorSchema = z.string().min(1).max(96);
export const experienceTipSearchLimit = 160;
const experienceTipSearchSchema = z.string().trim().max(experienceTipSearchLimit).optional();

export const experienceTipReadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('articles'),
    before: experienceTipCursorSchema.optional(),
    sort: experienceTipSortSchema.optional(),
    query: experienceTipSearchSchema,
  }),
  z.object({ kind: z.literal('my-submissions'), before: z.uuid().optional(), query: experienceTipSearchSchema }),
  z.object({ kind: z.literal('article'), tipId: z.uuid() }),
]);
export type ExperienceTipRead = z.infer<typeof experienceTipReadSchema>;

export const experienceTipLikeSchema = z.object({ tipId: z.uuid(), liked: z.boolean() }).strict();
export type ExperienceTipLike = z.infer<typeof experienceTipLikeSchema>;

const experienceTipRemovalActionSchema = z.enum(['withdraw', 'remove-returned', 'delete-tip']);
export type ExperienceTipRemovalAction = z.infer<typeof experienceTipRemovalActionSchema>;
export const experienceTipRemovalSchema = z.object({
  tipId: z.uuid(), versionId: z.uuid(), action: experienceTipRemovalActionSchema,
}).strict();
export type ExperienceTipRemoval = z.infer<typeof experienceTipRemovalSchema>;

export const experienceTipEngagementSchema = z.object({
  view_count: z.number().int().nonnegative(),
  like_count: z.number().int().nonnegative(),
  liked: z.boolean(),
});
export type ExperienceTipEngagement = z.infer<typeof experienceTipEngagementSchema>;

export type ExperienceTipResult = { ok: true; value: unknown } | {
  ok: false; status: number; code: string; message: string;
};

const experienceTipSummarySchema = z.object({
  id: z.uuid(),
  tip_id: z.uuid(),
  title: z.string(),
  author: z.string(),
  state: z.enum(['pending', 'returned', 'published']),
  review_note: z.string().nullable(),
  submitted_at: z.iso.datetime().nullable(),
  published_at: z.iso.datetime().nullable(),
  cover_url: z.url({ protocol: /^https?$/ }).optional(),
  excerpt: z.string().optional(),
  view_count: experienceTipEngagementSchema.shape.view_count.optional(),
  like_count: experienceTipEngagementSchema.shape.like_count.optional(),
  removal_action: experienceTipRemovalActionSchema.nullable().optional(),
  unlisted: z.object({ at: z.iso.datetime(), reason: z.string() }).optional(),
});

export const experienceTipPageSchema = z.object({
  items: z.array(experienceTipSummarySchema),
  next_cursor: experienceTipCursorSchema.nullable(),
});

export const experienceTipArticleSchema = experienceTipSummarySchema.extend({
  liked: z.boolean().optional(),
  theme: z.string().optional(),
  body: z.string(),
  images: z.array(z.object({
    id: z.uuid(),
    url: z.url({ protocol: /^https?$/ }),
  })),
});

export type ExperienceTipSummary = z.infer<typeof experienceTipSummarySchema>;
export type ExperienceTipPage = z.infer<typeof experienceTipPageSchema>;
export type ExperienceTipArticle = z.infer<typeof experienceTipArticleSchema>;
