import {
  readdir,
  readFile,
  mkdir,
  writeFile,
  appendFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const names = [
  'customUser:ci_run_id',
  'streamId',
  'eventName',
  'deviceCategory',
  'unifiedScreenName',
];

export function realtimeRequest(runId, streamId) {
  return {
    dimensions: names.map((name) => ({ name })),
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          ['customUser:ci_run_id', runId],
          ['streamId', streamId],
          ['eventName', 'page_view'],
        ].map(([fieldName, value]) => ({
          filter: {
            fieldName,
            stringFilter: { matchType: 'EXACT', value, caseSensitive: true },
          },
        })),
      },
    },
    limit: '100',
  };
}

export async function loadExpectedViews(
  directory,
  { runId, target, measurementId },
) {
  const evidence = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (
        entry.isFile() &&
        entry.name === 'production-network-evidence.json'
      )
        evidence.push(JSON.parse(await readFile(child, 'utf8')));
    }
  }
  await walk(directory);
  const expected = [];
  for (const [project, device] of [
    ['live-chromium', 'desktop'],
    ['live-mobile-safari', 'mobile'],
  ]) {
    const matches = evidence.filter(
      (item) => item.project === project && item.runId === runId,
    );
    if (
      matches.length !== 1 ||
      matches[0].journeyVerified !== true ||
      matches[0].target !== target ||
      matches[0].measurementId !== measurementId ||
      matches[0].deviceCategory !== device ||
      !Array.isArray(matches[0].expectedPageViews) ||
      matches[0].expectedPageViews.length < 8
    )
      throw new Error(
        'Missing complete, matching live journey evidence for ' + project + '.',
      );
    for (const view of matches[0].expectedPageViews) {
      if (
        typeof view.title !== 'string' ||
        !view.title.trim() ||
        typeof view.path !== 'string' ||
        !view.path.startsWith('/') ||
        new URL(view.path, target).origin !== target
      )
        throw new Error('Invalid expected page view in live journey evidence.');
      expected.push({ device, path: view.path, title: view.title });
    }
  }
  return expected;
}

export function evaluateReport(data, { runId, streamId, expectedViews }) {
  const dimensions = data.dimensionHeaders?.map((header) => header.name);
  const metrics = data.metricHeaders?.map((header) => header.name);
  if (
    data.kind !== 'analyticsData#runRealtimeReport' ||
    !names.every((name) => dimensions?.includes(name)) ||
    !metrics?.includes('eventCount') ||
    (data.rows !== undefined && !Array.isArray(data.rows))
  )
    throw new Error('Unexpected GA4 Realtime API response schema.');
  const rows = [];
  for (const row of data.rows || []) {
    const value = (name) =>
      row.dimensionValues?.[dimensions.indexOf(name)]?.value;
    const count = row.metricValues?.[metrics.indexOf('eventCount')]?.value;
    if (
      value('customUser:ci_run_id') !== runId ||
      value('streamId') !== streamId ||
      value('eventName') !== 'page_view'
    )
      throw new Error(
        'GA4 returned rows outside the requested run, stream, or event.',
      );
    if (!/^[0-9]+$/.test(count) || !Number.isSafeInteger(Number(count)))
      throw new Error('GA4 returned an invalid event count.');
    rows.push({
      device: value('deviceCategory'),
      title: value('unifiedScreenName'),
      eventCount: Number(count),
    });
  }
  const missing = expectedViews.filter(
    (view) =>
      !rows.some(
        (row) =>
          row.device === view.device &&
          row.title === view.title &&
          row.eventCount > 0,
      ),
  );
  return { verified: missing.length === 0, rows, missing };
}

export async function pollIngestion({
  propertyId,
  streamId,
  runId,
  token,
  expectedViews,
  fetchImpl = fetch,
  wait = delay,
  now = Date.now,
  timeoutMs = 180_000,
  intervalMs = 10_000,
  onProgress = async () => {},
}) {
  if (!expectedViews.length)
    throw new Error('No expected page views to verify.');
  const request = realtimeRequest(runId, streamId);
  const deadline = now() + timeoutMs;
  let attempts = 0;
  let result = { verified: false, rows: [], missing: expectedViews };
  while (true) {
    attempts++;
    const response = await fetchImpl(
      'https://analyticsdata.googleapis.com/v1beta/properties/' +
        propertyId +
        ':runRealtimeReport',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.ok) {
      result = evaluateReport(await response.json(), {
        runId,
        streamId,
        expectedViews,
      });
    } else if (response.status !== 429 && response.status < 500) {
      throw new Error(
        'GA4 Data API returned HTTP ' +
          response.status +
          '. Check API enablement, property Viewer access, and the registered User-scoped ci_run_id dimension.',
      );
    }
    const evidence = {
      status: result.verified ? 'verified' : 'pending',
      checkedAt: new Date(now()).toISOString(),
      propertyId,
      streamId,
      runId,
      attempts,
      request,
      expectedViews,
      ...result,
      lastHttpStatus: response.status,
    };
    await onProgress(evidence);
    if (result.verified) return evidence;
    const remaining = deadline - now();
    if (remaining <= 0)
      throw new Error('GA4 ingestion was not confirmed before the deadline.');
    await wait(Math.min(intervalMs, remaining));
  }
}

export async function main(env = process.env) {
  const output =
    env.GA4_READBACK_OUTPUT || 'test-results-production/ga4-api-readback.json';
  async function save(value) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(value, null, 2) + '\n');
  }
  try {
    const propertyId = env.GA4_PROPERTY_ID;
    const streamId = env.GA4_STREAM_ID;
    const runId = env.PLAYWRIGHT_RUN_ID;
    const target = new URL(env.PLAYWRIGHT_PRODUCTION_URL).origin;
    const measurementId = env.PLAYWRIGHT_GA4_MEASUREMENT_ID;
    if (
      !/^[0-9]+$/.test(propertyId || '') ||
      !/^[0-9]+$/.test(streamId || '') ||
      !runId ||
      runId.length > 36 ||
      !/^(gha-[0-9]+-[0-9]+|local-[a-z0-9][a-z0-9._-]*)$/.test(runId) ||
      !/^G-[A-Z0-9]+$/.test(measurementId || '') ||
      !env.GA4_ACCESS_TOKEN
    )
      throw new Error(
        'GA4 read-back requires valid property, stream, run, measurement, and access-token configuration.',
      );
    const expectedViews = await loadExpectedViews(
      env.GA4_EVIDENCE_DIRECTORY || 'test-results-production',
      { runId, target, measurementId },
    );
    const result = await pollIngestion({
      propertyId,
      streamId,
      runId,
      expectedViews,
      token: env.GA4_ACCESS_TOKEN,
      onProgress: async (evidence) => {
        await save(evidence);
        console.log(
          'GA4 API attempt ' +
            evidence.attempts +
            ': ' +
            (expectedViews.length - evidence.missing.length) +
            '/' +
            expectedViews.length +
            ' expected page/device pairs received.',
        );
      },
    });
    if (env.GITHUB_STEP_SUMMARY)
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        '\n### GA4 API ingestion verified\n\nRun: ' +
          runId +
          '\n\n' +
          expectedViews.length +
          ' expected page/device pairs confirmed by the Realtime Data API.\n',
      );
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'GA4 API verification failed.';
    // Keep the last pending response when available; never store credentials.
    let previous = {};
    try {
      previous = JSON.parse(await readFile(output, 'utf8'));
    } catch {}
    await save({ ...previous, status: 'failed', verified: false, message });
    if (env.GITHUB_STEP_SUMMARY)
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        '\n### GA4 API ingestion not verified\n\n' + message + '\n',
      );
    throw new Error(message);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
