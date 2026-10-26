const campaignNames = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id',
];

/** Only explicitly labelled CI visits receive a reportable run identifier. */
export function analyticsRunId(input: string): string | undefined {
  const params = new URL(input).searchParams;
  const runId = params.get('utm_content');
  if (
    params.get('utm_source') === 'playwright-ci' &&
    params.get('utm_medium') === 'testing' &&
    params.get('utm_campaign') === 'production-checks' &&
    validAnalyticsRunId(runId)
  )
    return runId!;
}

export function validAnalyticsRunId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 36 &&
    /^(gha-[0-9]+-[0-9]+|local-[a-z0-9][a-z0-9._-]*)$/.test(value)
  );
}

/** Exclude search text, fragments, and unrelated query parameters from analytics. */
export function analyticsLocation(input: string): string {
  const url = new URL(input);
  const clean = new URL(url.pathname, url.origin);
  for (const name of campaignNames) {
    const value = url.searchParams.get(name);
    if (value && /^[a-z0-9][a-z0-9._ /-]{0,127}$/i.test(value)) {
      clean.searchParams.set(name, value);
    }
  }
  return clean.href;
}

export function analyticsReferrer(input: string, origin: string): string {
  try {
    const url = new URL(input);
    return url.origin === origin
      ? `${url.origin}${url.pathname}`
      : `${url.origin}/`;
  } catch {
    return '';
  }
}
