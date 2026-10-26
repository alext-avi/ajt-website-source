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

const names = ['customUser:ci_run_id', 'streamId', 'unifiedScreenName'];

export function realtimeRequest(runId, streamId) {
  return {
    dimensions: names.map((name) => ({ name })),
    metrics: [{ name: 'screenPageViews' }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: 'customUser:ci_run_id',
              inListFilter: {
                values: [runId + '-d', runId + '-m'],
                caseSensitive: true,
              },
            },
          },
          ...[['streamId', streamId]].map(([fieldName, value]) => ({
            filter: {
              fieldName,
              stringFilter: { matchType: 'EXACT', value, caseSensitive: true },
            },
          })),
        ],
      },
    },
    limit: '100',
  };
}

export function realtimeEventRequest(runId, streamId) {
  const request = realtimeRequest(runId, streamId);
  return {
    ...request,
    dimensions: ['customUser:ci_run_id', 'streamId', 'eventName'].map(
      (name) => ({ name }),
    ),
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          ...request.dimensionFilter.andGroup.expressions,
          {
            filter: {
              fieldName: 'eventName',
              inListFilter: {
                values: ['page_view', 'screen_view'],
                caseSensitive: true,
              },
            },
          },
        ],
      },
    },
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
      (item) =>
        item.project === project &&
        item.workflowRunId === runId &&
        item.runId === runId + (device === 'desktop' ? '-d' : '-m'),
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
      expected.push({
        device,
        runId: matches[0].runId,
        path: view.path,
        title: view.title,
      });
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
    !metrics?.includes('screenPageViews') ||
    (data.rows !== undefined && !Array.isArray(data.rows))
  )
    throw new Error('Unexpected GA4 Realtime API response schema.');
  const rows = [];
  for (const row of data.rows || []) {
    const value = (name) =>
      row.dimensionValues?.[dimensions.indexOf(name)]?.value;
    const count = row.metricValues?.[metrics.indexOf('screenPageViews')]?.value;
    const browserRunId = value('customUser:ci_run_id');
    if (
      ![runId + '-d', runId + '-m'].includes(browserRunId) ||
      value('streamId') !== streamId
    )
      throw new Error('GA4 returned rows outside the requested run or stream.');
    if (!/^[0-9]+$/.test(count) || !Number.isSafeInteger(Number(count)))
      throw new Error('GA4 returned an invalid page-view count.');
    rows.push({
      runId: browserRunId,
      device: browserRunId === runId + '-d' ? 'desktop' : 'mobile',
      title: value('unifiedScreenName'),
      pageViews: Number(count),
    });
  }
  const missing = expectedViews.filter(
    (view) =>
      !rows.some(
        (row) =>
          row.device === view.device &&
          row.runId === view.runId &&
          row.title === view.title &&
          row.pageViews > 0,
      ),
  );
  return { verified: missing.length === 0, rows, missing };
}

export function evaluateEventReport(
  data,
  { runId, streamId, expectedViews, pageRows },
) {
  const dimensions = data.dimensionHeaders?.map((header) => header.name);
  const metrics = data.metricHeaders?.map((header) => header.name);
  if (
    data.rowCount !== undefined &&
    (!Number.isSafeInteger(data.rowCount) ||
      data.rowCount < 0 ||
      data.rowCount > (data.rows || []).length)
  )
    throw new Error(
      'Incomplete GA4 event report; refusing to infer absent event types.',
    );
  if (
    data.kind !== 'analyticsData#runRealtimeReport' ||
    !['customUser:ci_run_id', 'streamId', 'eventName'].every((name) =>
      dimensions?.includes(name),
    ) ||
    !metrics?.includes('eventCount') ||
    (data.rows !== undefined && !Array.isArray(data.rows))
  )
    throw new Error('Unexpected GA4 event report schema.');
  const rows = (data.rows || []).map((row) => {
    const value = (name) =>
      row.dimensionValues?.[dimensions.indexOf(name)]?.value;
    const browserRunId = value('customUser:ci_run_id');
    const count = row.metricValues?.[metrics.indexOf('eventCount')]?.value;
    if (
      ![runId + '-d', runId + '-m'].includes(browserRunId) ||
      value('streamId') !== streamId
    )
      throw new Error(
        'GA4 returned event rows outside the requested run or stream.',
      );
    if (
      typeof value('eventName') !== 'string' ||
      !/^[0-9]+$/.test(count) ||
      !Number.isSafeInteger(Number(count))
    )
      throw new Error('GA4 returned an invalid event count.');
    return {
      runId: browserRunId,
      event: value('eventName'),
      eventCount: Number(count),
    };
  });
  const missing = expectedViews.filter((view) => {
    const reportedViews = pageRows
      .filter((row) => row.runId === view.runId)
      .reduce((sum, row) => sum + row.pageViews, 0);
    const eventCount = (name) =>
      rows
        .filter((row) => row.runId === view.runId && row.event === name)
        .reduce((sum, row) => sum + row.eventCount, 0);
    return (
      reportedViews <= 0 ||
      eventCount('page_view') < reportedViews ||
      eventCount('screen_view') !== 0
    );
  });
  return { verified: missing.length === 0, rows, missing };
}

export function evaluateIngestionProbe(data, config) {
  const report = evaluateReport(data, config);
  const ingestionProbe = config.expectedViews.find((view) =>
    report.rows.some(
      (row) =>
        row.runId === view.runId &&
        row.title === view.title &&
        row.pageViews > 0,
    ),
  );
  return {
    ...report,
    verified: Boolean(ingestionProbe),
    ingestionProbe: ingestionProbe || null,
  };
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
  query,
  evaluate,
}) {
  if (!expectedViews.length)
    throw new Error('No expected page views to verify.');
  const request = query || realtimeRequest(runId, streamId);
  const deadline = now() + timeoutMs;
  let attempts = 0;
  let result = { verified: false, rows: [], missing: expectedViews };
  while (true) {
    if (attempts > 0 && now() >= deadline)
      throw new Error('GA4 ingestion was not confirmed before the deadline.');
    attempts++;
    let response;
    let data;
    try {
      response = await fetchImpl(
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
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(15_000, deadline - now())),
          ),
        },
      );
      if (response.ok) data = await response.json();
    } catch (error) {
      if (
        !(error instanceof TypeError) &&
        error?.name !== 'AbortError' &&
        error?.name !== 'TimeoutError'
      )
        throw error;
      response = { ok: false, status: 0 };
    }
    if (response.ok) {
      result = (evaluate || evaluateReport)(data, {
        runId,
        streamId,
        expectedViews,
      });
    } else if (
      response.status !== 0 &&
      response.status !== 429 &&
      response.status < 500
    ) {
      let detail = '';
      try {
        const failure = await response.json();
        if (typeof failure?.error?.message === 'string')
          detail =
            ' ' +
            failure.error.message
              .replaceAll(token, '[redacted]')
              .slice(0, 1000);
      } catch {
        /* The HTTP status remains actionable when an error body is unavailable. */
      }
      throw new Error(
        'GA4 Data API returned HTTP ' +
          response.status +
          '. Check API enablement, property Viewer access, and the registered User-scoped ci_run_id dimension.' +
          detail,
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
      lastHttpStatus: response.status || null,
      transportError: response.status === 0 ? 'request-failed' : null,
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
      runId.length > 34 ||
      !/^(gha-[0-9]+-[0-9]+|local-[a-z0-9][a-z0-9._-]*)$/.test(runId) ||
      !/^G-[A-Z0-9]+$/.test(measurementId || '') ||
      !env.GA4_ACCESS_TOKEN
    )
      throw new Error(
        'GA4 read-back requires valid property, stream, run, measurement, and access-token configuration.',
      );
    const journeyExpectedViews = await loadExpectedViews(
      env.GA4_EVIDENCE_DIRECTORY || 'test-results-production',
      { runId, target, measurementId },
    );
    // GA4 is aggregate telemetry, not a complete request log. Both browser
    // journeys must finish; this independent smoke check requires their
    // one actual visited page to be ingested and reports remaining coverage.
    const expectedViews = journeyExpectedViews;
    const coverage = (rows) => {
      const missing = journeyExpectedViews.filter(
        (view) =>
          !rows.some(
            (row) =>
              row.runId === view.runId &&
              row.title === view.title &&
              row.pageViews > 0,
          ),
      );
      return {
        expected: journeyExpectedViews.length,
        observed: journeyExpectedViews.length - missing.length,
        complete: missing.length === 0,
        missing,
      };
    };
    const pages = await pollIngestion({
      propertyId,
      streamId,
      runId,
      expectedViews,
      token: env.GA4_ACCESS_TOKEN,
      evaluate: evaluateIngestionProbe,
      onProgress: async (evidence) => {
        await save({
          ...evidence,
          status: 'pages-pending',
          verified: false,
          journeyExpectedViews,
          reportingCoverage: coverage(evidence.rows),
          verificationScope: 'run-ingestion',
        });
        console.log(
          'GA4 API attempt ' +
            evidence.attempts +
            ': ' +
            coverage(evidence.rows).observed +
            '/' +
            journeyExpectedViews.length +
            ' journey page/browser pairs reported; current-run ingestion beacon ' +
            (evidence.verified ? 'confirmed.' : 'pending.'),
        );
      },
    });
    const eventVerification = await pollIngestion({
      propertyId,
      streamId,
      runId,
      expectedViews: [pages.ingestionProbe],
      token: env.GA4_ACCESS_TOKEN,
      query: realtimeEventRequest(runId, streamId),
      evaluate: (data, config) =>
        evaluateEventReport(data, { ...config, pageRows: pages.rows }),
      onProgress: async (evidence) => {
        await save({
          ...pages,
          journeyExpectedViews,
          reportingCoverage: coverage(pages.rows),
          verificationScope: 'run-ingestion',
          status: evidence.verified ? 'verified' : 'events-pending',
          verified: evidence.verified,
          eventVerification: evidence,
        });
        console.log(
          'GA4 event-type attempt ' +
            evidence.attempts +
            ': ' +
            (evidence.verified
              ? 'page_view totals confirmed; no screen_view events.'
              : 'waiting for matching page_view totals without screen_view events.'),
        );
      },
    });
    const result = {
      ...pages,
      journeyExpectedViews,
      reportingCoverage: coverage(pages.rows),
      verificationScope: 'run-ingestion',
      status: 'verified',
      verified: true,
      eventVerification,
    };
    if (env.GITHUB_STEP_SUMMARY)
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        '\n### GA4 API ingestion verified\n\nRun: ' +
          runId +
          '\n\n' +
          'A visited page from this run was confirmed by the page and event reports. Probe: ' +
          pages.ingestionProbe.device +
          ' ' +
          pages.ingestionProbe.path +
          '. Both full browser journeys passed server and collection checks.\n\nObserved GA4 reporting coverage: ' +
          coverage(pages.rows).observed +
          '/' +
          journeyExpectedViews.length +
          ' journey page/browser pairs. This is an ingestion smoke check; it does not attest complete analytics capture of every automated visit.\n',
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
