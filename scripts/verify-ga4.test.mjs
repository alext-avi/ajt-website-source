import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  realtimeRequest,
  evaluateReport,
  pollIngestion,
  loadExpectedViews,
} from './verify-ga4.mjs';

const runId = 'gha-12345-1';
const streamId = '16200089700';
const expectedViews = ['desktop', 'mobile'].flatMap((device) =>
  Array.from({ length: 8 }, (_, i) => ({
    device,
    runId: runId + (device === 'desktop' ? '-d' : '-m'),
    path: '/page-' + i,
    title: 'Page ' + i,
  })),
);
const options = { runId, streamId, expectedViews };
function report(views = expectedViews) {
  return {
    kind: 'analyticsData#runRealtimeReport',
    dimensionHeaders: [
      { name: 'eventName' },
      { name: 'unifiedScreenName' },
      { name: 'customUser:ci_run_id' },
      { name: 'streamId' },
    ],
    metricHeaders: [{ name: 'eventCount' }],
    rows: views.map((view) => ({
      dimensionValues: ['page_view', view.title, view.runId, streamId].map(
        (value) => ({ value }),
      ),
      metricValues: [{ value: '1' }],
    })),
  };
}
const ok = (data) => ({ ok: true, status: 200, json: async () => data });

test('the API request verifies exact page_view events within the total dimension limit', () => {
  const request = realtimeRequest(runId, streamId);
  assert.equal(request.dimensions.length, 4);
  assert.deepEqual(
    request.dimensions.map(({ name }) => name),
    ['customUser:ci_run_id', 'streamId', 'eventName', 'unifiedScreenName'],
  );
  assert.deepEqual(
    Object.fromEntries(
      request.dimensionFilter.andGroup.expressions
        .slice(1)
        .map(({ filter }) => {
          assert.equal(filter.stringFilter.matchType, 'EXACT');
          assert.equal(filter.stringFilter.caseSensitive, true);
          return [filter.fieldName, filter.stringFilter.value];
        }),
    ),
    { streamId, eventName: 'page_view' },
  );
  assert.deepEqual(request.dimensionFilter.andGroup.expressions[0], {
    filter: {
      fieldName: 'customUser:ci_run_id',
      inListFilter: {
        values: [runId + '-d', runId + '-m'],
        caseSensitive: true,
      },
    },
  });
  assert.deepEqual(request.metrics, [{ name: 'eventCount' }]);
  const referencedDimensions = new Set([
    ...request.dimensions.map(({ name }) => name),
    ...request.dimensionFilter.andGroup.expressions.map(
      ({ filter }) => filter.fieldName,
    ),
  ]);
  assert.equal(referencedDimensions.size, 4);
});

test('API read-back verifies both devices and all pages using the returned headers', () => {
  assert.equal(evaluateReport(report(), options).verified, true);
  const partial = evaluateReport(
    report(expectedViews.filter((v) => v.device === 'desktop')),
    options,
  );
  assert.equal(partial.verified, false);
  assert.equal(partial.missing.length, 8);
  assert.ok(partial.missing.every((view) => view.device === 'mobile'));
});

test('unrelated runs, streams, screen_view events, or malformed counts cannot satisfy ingestion', () => {
  for (const [index, value] of [
    [2, 'gha-old-1'],
    [3, 'another-stream'],
    [0, 'screen_view'],
  ]) {
    const data = report();
    data.rows[0].dimensionValues[index].value = value;
    assert.throws(() => evaluateReport(data, options), /outside the requested/);
  }
  const malformed = report();
  malformed.rows[0].metricValues[0].value = 'NaN';
  assert.throws(
    () => evaluateReport(malformed, options),
    /invalid page-view count/,
  );
  const zero = report();
  zero.rows[0].metricValues[0].value = '0';
  assert.equal(evaluateReport(zero, options).verified, false);
});

test('polling waits for processed rows and never saves the access token in evidence', async () => {
  let calls = 0;
  let clock = 0;
  const evidence = [];
  const result = await pollIngestion({
    ...options,
    propertyId: '560723382',
    token: 'test-token-not-for-evidence',
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
    fetchImpl: async (url, request) => {
      assert.equal(
        url,
        'https://analyticsdata.googleapis.com/v1beta/properties/560723382:runRealtimeReport',
      );
      assert.equal(
        request.headers.Authorization,
        'Bearer test-token-not-for-evidence',
      );
      return ok(++calls === 1 ? report([]) : report());
    },
    onProgress: async (item) => evidence.push(item),
  });
  assert.equal(result.verified, true);
  assert.equal(calls, 2);
  assert.equal(evidence[0].status, 'pending');
  assert.equal(
    JSON.stringify(evidence).includes('test-token-not-for-evidence'),
    false,
  );
});

test('empty GA4 reports time out without a false success', async () => {
  let clock = 0;
  const progress = [];
  await assert.rejects(
    pollIngestion({
      ...options,
      propertyId: '560723382',
      token: 'test',
      timeoutMs: 100,
      intervalMs: 50,
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
      fetchImpl: async () => ok(report([])),
      onProgress: async (item) => progress.push(item),
    }),
    /not confirmed before the deadline/,
  );
  assert.ok(progress.length >= 2);
  assert.ok(progress.every((item) => item.verified === false));
});

test('permission errors fail immediately, while transient quota errors can recover', async () => {
  let calls = 0;
  await assert.rejects(
    pollIngestion({
      ...options,
      propertyId: '560723382',
      token: 'test',
      fetchImpl: async () => {
        calls++;
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { message: 'Access denied for test' } }),
        };
      },
    }),
    (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.match(error.message, /Access denied for \[redacted\]/);
      assert.ok(!error.message.includes('test'));
      return true;
    },
  );
  assert.equal(calls, 1);
  calls = 0;
  assert.equal(
    (
      await pollIngestion({
        ...options,
        propertyId: '560723382',
        token: 'test',
        fetchImpl: async () =>
          ++calls === 1 ? { ok: false, status: 429 } : ok(report()),
        wait: async () => {},
      })
    ).verified,
    true,
  );
});

test('only complete live journey manifests from this run and target can be used', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ajt-ga4-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = 'https://site.test';
  const measurementId = 'G-TEST123';
  const manifest = (project, device) => ({
    project,
    deviceCategory: device,
    journeyVerified: true,
    workflowRunId: runId,
    runId: runId + (device === 'desktop' ? '-d' : '-m'),
    target,
    measurementId,
    expectedPageViews: expectedViews.filter((view) => view.device === device),
  });
  const desktop = manifest('live-chromium', 'desktop');
  const mobile = manifest('live-mobile-safari', 'mobile');
  await mkdir(join(directory, 'desktop'));
  await mkdir(join(directory, 'mobile'));
  const desktopPath = join(
    directory,
    'desktop/production-network-evidence.json',
  );
  await writeFile(desktopPath, JSON.stringify(desktop));
  await writeFile(
    join(directory, 'mobile/production-network-evidence.json'),
    JSON.stringify(mobile),
  );
  const config = { runId, target, measurementId };
  assert.equal((await loadExpectedViews(directory, config)).length, 16);
  for (const replacement of [
    { ...desktop, runId: 'gha-older-1' },
    { ...desktop, journeyVerified: false },
    { ...desktop, target: 'https://other.test' },
  ]) {
    await writeFile(desktopPath, JSON.stringify(replacement));
    await assert.rejects(
      loadExpectedViews(directory, config),
      /Missing complete/,
    );
  }
});

test('network failures and request timeouts retry inside the deadline', async () => {
  let calls = 0;
  let clock = 0;
  const progress = [];
  const result = await pollIngestion({
    ...options,
    propertyId: '560723382',
    token: 'test',
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      if (calls === 2)
        throw new DOMException('request timed out', 'TimeoutError');
      return ok(report());
    },
    onProgress: async (item) => progress.push(item),
  });
  assert.equal(result.verified, true);
  assert.equal(calls, 3);
  assert.equal(progress[0].lastHttpStatus, null);
  assert.equal(progress[1].transportError, 'request-failed');
  clock = 0;
  calls = 0;
  await assert.rejects(
    pollIngestion({
      ...options,
      propertyId: '560723382',
      token: 'test',
      timeoutMs: 100,
      intervalMs: 50,
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
      fetchImpl: async () => {
        calls++;
        throw new TypeError('connection reset');
      },
    }),
    /not confirmed before the deadline/,
  );
  assert.equal(clock, 100);
  assert.equal(calls, 2);
});

test('body transport failures retry, while malformed JSON fails immediately', async () => {
  let calls = 0;
  const result = await pollIngestion({
    ...options,
    propertyId: '560723382',
    token: 'test',
    wait: async () => {},
    fetchImpl: async () => {
      calls++;
      if (calls === 1)
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new DOMException('body timed out', 'TimeoutError');
          },
        };
      return ok(report());
    },
  });
  assert.equal(result.verified, true);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    pollIngestion({
      ...options,
      propertyId: '560723382',
      token: 'test',
      fetchImpl: async () => {
        calls++;
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('invalid JSON');
          },
        };
      },
    }),
    SyntaxError,
  );
  assert.equal(calls, 1);
});
