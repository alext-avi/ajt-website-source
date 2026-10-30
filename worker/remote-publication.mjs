import { createHash, randomBytes } from 'node:crypto';
import { getPost, validateDraft } from '../mcp/content-service.mjs';
import { postMedia } from '../mcp/content-render.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const digest = (item) =>
  hash(
    JSON.stringify({
      slug: item.slug,
      metadata: item.metadata,
      body: item.body,
      revision: item.revision,
    }),
  );

// Called only by the App RPC adapter. Authentication is checked before dispatch.
// App-only visibility is a host-enforced workflow boundary, not human attestation.
export function remotePublication(store, ownerId, siteUrl) {
  async function ticket(token) {
    if (!/^[a-f0-9]{48}$/.test(token)) throw new Error('Invalid preview');
    const row = await store.db
      .prepare(
        'SELECT * FROM authoring_previews WHERE token_hash=? AND owner_id=?',
      )
      .bind(hash(token), ownerId)
      .first();
    if (!row || (row.status === 'ready' && row.expires_at < Date.now()))
      throw new Error('This preview expired. Refresh before posting.');
    return row;
  }
  function result(row) {
    return {
      status: row.status === 'posted' ? 'posted' : 'ready',
      localOnly: store.localOnly === true,
      message:
        row.status === 'posted'
          ? 'Posted. Your approved revision is available on the website.'
          : 'Ready for your Post click.',
      ...(row.status === 'posted'
        ? {
            url: new URL(
              `/${row.collection === 'posts' ? 'writing' : 'projects'}/${row.slug}/`,
              siteUrl,
            ).href,
          }
        : {}),
    };
  }
  return {
    async prepare(item, collection) {
      if (!item.metadata.draft) return undefined;
      await store.db
        .prepare('DELETE FROM authoring_previews WHERE expires_at<?')
        .bind(Date.now())
        .run();
      const count = await store.db
        .prepare(
          'SELECT count(*) AS n FROM authoring_previews WHERE owner_id=?',
        )
        .bind(ownerId)
        .first();
      if (count.n >= 32)
        throw new Error(
          'Too many open previews. Wait before refreshing again.',
        );
      const token = randomBytes(24).toString('hex');
      await store.db
        .prepare(
          'INSERT INTO authoring_previews(token_hash,owner_id,collection,slug,revision,digest,expires_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(
          hash(token),
          ownerId,
          collection,
          item.slug,
          item.revision,
          digest(item),
          Date.now() + 600_000,
        )
        .run();
      return token;
    },
    async post(token) {
      const row = await ticket(token);
      if (row.status === 'posted') return result(row);
      await store.ensureRuntime?.();
      const item = await getPost(store, row.slug, row.collection);
      if (
        !item.metadata.draft ||
        item.revision !== row.revision ||
        digest(item) !== row.digest
      )
        throw new Error(
          'The draft changed. Refresh the saved preview before posting.',
        );
      await validateDraft(
        item.slug,
        item.metadata,
        item.body,
        store,
        row.collection,
      );
      const assets = await postMedia(item);
      const statements = [
        store.db
          .prepare(
            `UPDATE content_items SET metadata_json=json_set(metadata_json,'$.draft',json('false')),revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE collection=? AND slug=? AND revision=? AND is_draft=1
        AND EXISTS(SELECT 1 FROM authoring_previews WHERE token_hash=? AND owner_id=? AND status='ready' AND expires_at>=? AND digest=?) RETURNING revision`,
          )
          .bind(
            'human-app:' + ownerId,
            row.collection,
            row.slug,
            row.revision,
            hash(token),
            ownerId,
            Date.now(),
            row.digest,
          ),
      ];
      for (const url of assets)
        statements.push(
          store.db
            .prepare(
              `INSERT OR IGNORE INTO published_media(collection,slug,revision,url)
        SELECT collection,slug,revision+1,? FROM authoring_previews WHERE token_hash=? AND owner_id=? AND status='posted'`,
            )
            .bind(url, hash(token), ownerId),
        );
      // D1 batch is transactional. Snapshot/history/ticket triggers and media
      // permissions either commit together or all roll back. There is no deploy.
      await store.db.batch(statements);
      const final = await ticket(token);
      if (final.status !== 'posted')
        throw new Error(
          'The draft changed or preview expired. Refresh before posting.',
        );
      return result(final);
    },
    async status(token) {
      return result(await ticket(token));
    },
  };
}
