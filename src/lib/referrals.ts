const slug = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const campaignValue = /^[a-z0-9][a-z0-9._ /-]{0,127}$/;

/** The public path identifies the source; an optional suffix identifies a campaign. */
export function referralDestination(input: URL): URL | undefined {
  if (!input.pathname.startsWith('/r/')) return;
  let parts: string[];
  try {
    parts = input.pathname
      .slice(3)
      .replace(/\/$/, '')
      .split('/')
      .map((part) => decodeURIComponent(part).toLowerCase());
  } catch {
    return;
  }
  if (parts.length > 4 || !parts.every((part) => slug.test(part))) return;
  if (parts.slice(1).join('/').length > 128) return;

  const destination = new URL('/', input.origin);
  destination.searchParams.set('utm_source', parts[0]);
  destination.searchParams.set('utm_medium', 'referral');
  destination.searchParams.set(
    'utm_campaign',
    parts.slice(1).join('/') || 'shared-link',
  );
  for (const name of [
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'utm_id',
  ]) {
    const value = input.searchParams.get(name)?.trim().toLowerCase();
    if (value && campaignValue.test(value))
      destination.searchParams.set(name, value);
  }
  return destination;
}
