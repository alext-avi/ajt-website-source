import { parseArgs } from 'node:util';
import { createStore } from '../mcp/content-server.mjs';
import { publishedMediaStatements } from './lib/published-media.mjs';

const { values } = parseArgs({
  options: {
    remote: { type: 'boolean' },
    database: { type: 'string' },
  },
});
if (Boolean(values.remote) === Boolean(values.database))
  throw new Error('Select --remote or an isolated local --database path');
const store = await createStore({
  remote: values.remote,
  database: values.database,
});
try {
  const rows = await store.query('SELECT * FROM published_content');
  let registered = 0;
  for (const row of rows) {
    const statements = await publishedMediaStatements(
      {
        collection: row.collection,
        slug: row.slug,
        data: JSON.parse(row.metadata_json),
        body: row.body_markdown,
      },
      row.revision,
    );
    for (const statement of statements) {
      await store.query(statement);
      registered++;
    }
  }
  console.log(
    `Checked ${rows.length} already-approved entries; registered ${registered} media references. No content or draft status changed.`,
  );
} finally {
  store.close();
}
