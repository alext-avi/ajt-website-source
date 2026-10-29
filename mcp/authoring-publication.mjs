import { randomBytes } from 'node:crypto';
import {
  createReview,
  postDigest,
  publishReview,
  readReview,
} from './reviews.mjs';

// These capabilities belong to the rendered App session, never to draft tools.
// Visibility hides the publication RPC from models; it is not authentication
// against another local MCP client running as the same OS user.
export function authoringPublication(store, getPost) {
  const sessions = new Map();
  const lifetime = 10 * 60_000;
  function session(token) {
    const value = sessions.get(token);
    if (!value || (value.status === 'ready' && value.expires < Date.now()))
      throw new Error(
        'This preview expired. Refresh the preview before posting.',
      );
    return value;
  }
  function result(value) {
    return {
      status: value.status,
      localOnly: store.identity.startsWith('sqlite:'),
      ...(value.message ? { message: value.message } : {}),
      ...(value.reviewUrl ? { reviewUrl: value.reviewUrl } : {}),
    };
  }
  return {
    prepare(item, collection) {
      if (!item.metadata.draft) return undefined;
      for (const [token, value] of sessions) {
        if (value.expires < Date.now() && value.status !== 'publishing')
          sessions.delete(token);
      }
      if (sessions.size >= 32)
        throw new Error(
          'Too many open previews. Wait before refreshing again.',
        );
      const token = randomBytes(24).toString('hex');
      sessions.set(token, {
        slug: item.slug,
        collection,
        digest: postDigest(item),
        status: 'ready',
        expires: Date.now() + lifetime,
      });
      return token;
    },
    post(token) {
      const value = session(token);
      if (value.status !== 'ready') return result(value);
      // Reserve before any I/O: repeat clicks/polls cannot start another job.
      value.status = 'publishing';
      value.message = 'Posting: checking the saved revision and release…';
      void (async () => {
        const current = await getPost(store, value.slug, value.collection);
        if (!current.metadata.draft || postDigest(current) !== value.digest)
          throw new Error(
            'The draft changed. Refresh the saved preview before posting.',
          );
        const ticket = await createReview(current, store.identity);
        value.reviewUrl = ticket.reviewUrl;
        const review = await readReview(ticket.id);
        await publishReview(store, ticket.id, review.csrf);
        value.status = 'posted';
        value.message = store.identity.startsWith('sqlite:')
          ? 'Posted in the local test database. No remote content or deployment changed.'
          : 'Posted. Your content is live on the website.';
      })().catch((error) => {
        value.status = 'failed';
        value.message =
          error.message ||
          'Posting failed. Open the draft to inspect its status before retrying.';
      });
      return result(value);
    },
    status(token) {
      return result(session(token));
    },
  };
}
