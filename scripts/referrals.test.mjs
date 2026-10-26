import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';
import { referralDestination } from '../src/lib/referrals.ts';
import {
  analyticsLocation,
  analyticsReferrer,
  analyticsRunId,
  validAnalyticsRunId,
} from '../src/lib/analytics.ts';

test('only explicit production-test campaigns get a bounded GA4 run property', () => {
  const base =
    'https://site.test/?utm_source=playwright-ci&utm_medium=testing&utm_campaign=production-checks&utm_content=';
  assert.equal(analyticsRunId(base + 'gha-12345-1'), 'gha-12345-1');
  assert.equal(
    analyticsRunId(base + 'local-proof-20261026-03'),
    'local-proof-20261026-03',
  );
  assert.equal(
    analyticsRunId(base.replace('playwright-ci', 'linkedin') + 'gha-12345-1'),
    undefined,
  );
  assert.equal(analyticsRunId(base + 'email@example.test'), undefined);
  assert.equal(analyticsRunId(base + 'local-' + 'a'.repeat(31)), undefined);
  assert.equal(validAnalyticsRunId(null), false);
});

test('new referral sources work without registration and normalize consistently', () => {
  const linkedIn = referralDestination(
    new URL('https://site.test/r/LinkedIn/'),
  );
  assert.equal(linkedIn.origin, 'https://site.test');
  assert.equal(linkedIn.pathname, '/');
  assert.equal(linkedIn.searchParams.get('utm_source'), 'linkedin');
  assert.equal(linkedIn.searchParams.get('utm_campaign'), 'shared-link');
  assert.equal(
    referralDestination(
      new URL('https://site.test/r/new-event-2027'),
    ).searchParams.get('utm_source'),
    'new-event-2027',
  );
  const campaign = referralDestination(
    new URL('https://site.test/r/linkedin/agentic-sdlc?utm_content=post-1'),
  );
  assert.equal(campaign.searchParams.get('utm_campaign'), 'agentic-sdlc');
  assert.equal(campaign.searchParams.get('utm_content'), 'post-1');
});

test('referral queries cannot change the destination or replace the path source', () => {
  const url = referralDestination(
    new URL(
      'https://site.test/r/linkedin?next=https://evil.test&email=a@example.com&utm_source=other&utm_medium=social&utm_campaign=Launch',
    ),
  );
  assert.equal(url.origin, 'https://site.test');
  assert.equal(url.pathname, '/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    utm_source: 'linkedin',
    utm_medium: 'social',
    utm_campaign: 'launch',
  });
  for (const path of [
    '/r/',
    '/r/%2F%2Fevil.test',
    '/r/%ZZ',
    '/r/a//b',
    '/r/a@example.com',
    '/writing/',
  ]) {
    assert.equal(
      referralDestination(new URL(`https://site.test${path}`)),
      undefined,
      path,
    );
  }
});

test('the edge route redirects temporarily and retains ordinary asset and 404 behavior', async () => {
  const env = {
    ASSETS: {
      fetch: async () => new Response('asset response', { status: 404 }),
    },
  };
  for (const method of ['GET', 'HEAD']) {
    const response = await worker.fetch(
      new Request('https://site.test/r/anything-new', { method }),
      env,
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
  assert.equal(
    (
      await worker.fetch(
        new Request('https://site.test/r/linkedin', { method: 'POST' }),
        env,
      )
    ).status,
    405,
  );
  assert.equal(
    (await worker.fetch(new Request('https://site.test/unknown/'), env)).status,
    404,
  );
  const invalid = await worker.fetch(
    new Request('https://site.test/r/%2F%2Fevil.test'),
    {
      ASSETS: {
        fetch: async () =>
          Response.redirect('https://site.test/r/evil.test', 307),
      },
    },
  );
  assert.equal(invalid.status, 404);
  assert.equal(invalid.headers.get('Location'), null);
});

test('analytics keeps campaign attribution while excluding unrelated URL data', () => {
  assert.equal(
    analyticsLocation(
      'https://site.test/writing/?q=private+search&email=a@example.com&utm_source=linkedin&utm_campaign=launch#fragment',
    ),
    'https://site.test/writing/?utm_source=linkedin&utm_campaign=launch',
  );
  assert.equal(
    analyticsLocation('https://site.test/?utm_campaign=a@example.com'),
    'https://site.test/',
  );
  assert.equal(
    analyticsReferrer(
      'https://external.test/private?secret=value',
      'https://site.test',
    ),
    'https://external.test/',
  );
  assert.equal(
    analyticsReferrer(
      'https://site.test/writing/?q=query',
      'https://site.test',
    ),
    'https://site.test/writing/',
  );
});
