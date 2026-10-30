import { z } from 'zod/v4';

const localImage = z
  .string()
  .regex(
    /^\/images\/|^\/uploads\/|^\/media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/,
    'Use a local image asset or uploaded /media/ image',
  )
  .optional();
const common = {
  title: z.string().min(5),
  summary: z.string().min(20).max(300),
  draft: z.boolean().default(true),
  featured: z.boolean().default(false),
  example: z.boolean().default(false),
  tags: z.array(z.string().min(1)).default([]),
  image: localImage,
  imageAlt: z.string().optional(),
};
const resource = z.object({ label: z.string().min(1), url: z.url() });
export const postSchema = z.object({
  ...common,
  date: z.coerce.date(),
  updated: z.coerce.date().optional(),
  category: z.enum([
    'Applied AI',
    'Engineering leadership',
    'Architecture',
    'Developer tools',
    'Events & reflections',
  ]),
  linkedinUrl: z
    .url()
    .regex(/^https:\/\/www\.linkedin\.com\/(posts\/|feed\/update\/)/)
    .optional(),
  linkedinRepost: z.boolean().default(false),
  linkedinVideo: z.boolean().default(false),
  video: z
    .string()
    .regex(/^\/videos\/[a-z0-9-]+\.mp4$|^\/media\/[a-f0-9]{64}\.mp4$/)
    .optional(),
  videoPoster: localImage,
  videoWidth: z.number().int().positive().default(1280),
  videoHeight: z.number().int().positive().default(720),
  linkedinVideoEmbed: z
    .url()
    .regex(
      /^https:\/\/www\.linkedin\.com\/embed\/feed\/update\/urn:li:ugcPost:\d+\?compact=1$/,
    )
    .optional(),
  linkedinVideoCredit: z.string().optional(),
  linkedinVideoSource: z
    .url()
    .regex(/^https:\/\/www\.linkedin\.com\/(posts\/|feed\/update\/)/)
    .optional(),
});

export const projectSchema = z.object({
  ...common,
  role: z.string().min(3),
  technologies: z.array(z.string()).default([]),
  outcomes: z.array(z.string()).default([]),
  repository: z
    .url()
    .refine(
      (url) => /^https?:\/\//.test(url),
      'Use an HTTP or HTTPS repository URL',
    )
    .optional(),
  relatedArticles: z.array(z.string()).default([]),
  order: z.number().default(0),
  kind: z.enum(['systems', 'agents', 'mobile', 'platform']).default('systems'),
});

export const talkSchema = z
  .object({
    ...common,
    event: z.string().optional(),
    date: z.coerce.date().optional(),
    location: z.string().optional(),
    audience: z.string(),
    status: z.enum(['proposed', 'upcoming', 'past']),
    slides: z
      .union([
        z.url(),
        z
          .string()
          .regex(/^\/slides\/[a-z0-9-]+\.pdf$|^\/media\/[a-f0-9]{64}\.pdf$/),
      ])
      .optional(),
    video: z.url().optional(),
    resources: z.array(resource).default([]),
    relatedArticles: z.array(z.string()).default([]),
  })
  .superRefine((talk, ctx) => {
    if (
      talk.status === 'upcoming' &&
      (!talk.event || !talk.date || !talk.location)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Upcoming talks require an event, date, and location.',
      });
    if (talk.status === 'past' && !talk.event)
      ctx.addIssue({
        code: 'custom',
        message: 'Past sessions require an event or engagement context.',
      });
  });

export const contentSchemas = {
  posts: postSchema,
  projects: projectSchema,
  talks: talkSchema,
};
