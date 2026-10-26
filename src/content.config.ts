import { defineCollection } from 'astro:content';
import { contentLoader } from './lib/content-loader';
import { contentSchemas } from './lib/content-schemas';

export const collections = {
  posts: defineCollection({
    loader: contentLoader('posts'),
    schema: contentSchemas.posts,
  }),
  projects: defineCollection({
    loader: contentLoader('projects'),
    schema: contentSchemas.projects,
  }),
  talks: defineCollection({
    loader: contentLoader('talks'),
    schema: contentSchemas.talks,
  }),
};
