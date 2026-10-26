import { config, fields, collection } from '@keystatic/core';

const repo = import.meta.env.PUBLIC_KEYSTATIC_REPO;
const githubMode = import.meta.env.MODE === 'github';
if (githubMode && !repo?.match(/^[\w.-]+\/[\w.-]+$/))
  throw new Error(
    'Set PUBLIC_KEYSTATIC_REPO=owner/repository before starting GitHub mode.',
  );
const textList = (label: string) =>
  fields.array(fields.text({ label: 'Value' }), {
    label,
    itemLabel: (props) => props.value,
  });
const common = () => ({
  title: fields.slug({
    name: { label: 'Title', validation: { isRequired: true } },
  }),
  summary: fields.text({
    label: 'Summary',
    multiline: true,
    validation: { isRequired: true, length: { min: 20, max: 300 } },
  }),
  draft: fields.checkbox({
    label: 'Draft (excluded from public builds)',
    defaultValue: true,
  }),
  featured: fields.checkbox({ label: 'Feature on homepage' }),
  example: fields.checkbox({ label: 'Label as example content' }),
  tags: textList('Topics / tags'),
  image: fields.image({
    label: 'Cover image',
    directory: 'public/uploads',
    publicPath: '/uploads/',
  }),
  imageAlt: fields.text({ label: 'Image description' }),
});
const body = () =>
  fields.mdx({
    label: 'Content',
    options: {
      image: { directory: 'public/uploads', publicPath: '/uploads/' },
    },
  });

export default config({
  storage: githubMode
    ? { kind: 'github', repo: repo as `${string}/${string}` }
    : { kind: 'local' },
  ui: {
    brand: { name: 'Alexander Thomas' },
    navigation: { Content: ['posts', 'projects', 'talks'] },
  },
  collections: {
    posts: collection({
      label: 'Writing',
      slugField: 'title',
      path: 'src/content/posts/*',
      format: { contentField: 'content' },
      schema: {
        ...common(),
        date: fields.date({
          label: 'Publication date',
          validation: { isRequired: true },
        }),
        updated: fields.date({ label: 'Last updated' }),
        category: fields.select({
          label: 'Category',
          options: [
            'Applied AI',
            'Engineering leadership',
            'Architecture',
            'Developer tools',
            'Events & reflections',
          ].map((value) => ({ label: value, value })),
          defaultValue: 'Applied AI',
        }),
        linkedinUrl: fields.url({ label: 'Original LinkedIn post' }),
        linkedinRepost: fields.checkbox({
          label: 'Commentary on a shared LinkedIn post',
        }),
        linkedinVideo: fields.checkbox({
          label: 'Video available on LinkedIn',
        }),
        video: fields.text({ label: 'Local video path (/videos/name.mp4)' }),
        videoPoster: fields.image({
          label: 'Video poster',
          directory: 'public/uploads',
          publicPath: '/uploads/',
        }),
        videoWidth: fields.integer({
          label: 'Video width',
          defaultValue: 1280,
        }),
        videoHeight: fields.integer({
          label: 'Video height',
          defaultValue: 720,
        }),
        linkedinVideoEmbed: fields.url({
          label: 'LinkedIn video-only embed URL',
        }),
        linkedinVideoCredit: fields.text({ label: 'Original video creator' }),
        linkedinVideoSource: fields.url({
          label: 'Original creator’s video post',
        }),
        content: body(),
      },
    }),
    projects: collection({
      label: 'Projects',
      slugField: 'title',
      path: 'src/content/projects/*',
      format: { contentField: 'content' },
      schema: {
        ...common(),
        role: fields.text({
          label: 'Role and responsibilities',
          validation: { isRequired: true },
        }),
        technologies: textList('Technologies'),
        outcomes: textList('Verified outcomes'),
        repository: fields.url({ label: 'Public repository' }),
        relatedArticles: textList('Related article slugs'),
        order: fields.integer({ label: 'Display order', defaultValue: 0 }),
        kind: fields.select({
          label: 'Illustration style',
          options: ['systems', 'agents', 'mobile', 'platform'].map((value) => ({
            label: value,
            value,
          })),
          defaultValue: 'systems',
        }),
        content: body(),
      },
    }),
    talks: collection({
      label: 'Speaking',
      slugField: 'title',
      path: 'src/content/talks/*',
      format: { contentField: 'content' },
      schema: {
        ...common(),
        event: fields.text({ label: 'Event or engagement context' }),
        date: fields.date({
          label: 'Public event date (optional for past sessions)',
        }),
        location: fields.text({ label: 'Location' }),
        audience: fields.text({
          label: 'Audience',
          validation: { isRequired: true },
        }),
        status: fields.select({
          label: 'Status',
          options: [
            { label: 'Proposed topic, no confirmed event', value: 'proposed' },
            { label: 'Upcoming', value: 'upcoming' },
            { label: 'Past', value: 'past' },
          ],
          defaultValue: 'proposed',
        }),
        slides: fields.text({
          label: 'Presentation slides (public URL or /slides/name.pdf)',
        }),
        video: fields.url({ label: 'Video recording' }),
        resources: fields.array(
          fields.object({
            label: fields.text({
              label: 'Resource name',
              validation: { isRequired: true },
            }),
            url: fields.url({ label: 'URL', validation: { isRequired: true } }),
          }),
          {
            label: 'Resources',
            itemLabel: (props) => props.fields.label.value,
          },
        ),
        relatedArticles: textList('Related article slugs'),
        content: body(),
      },
    }),
  },
});
