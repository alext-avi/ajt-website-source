import {
  analyticsLocation,
  analyticsReferrer,
  analyticsRunId,
  validAnalyticsRunId,
} from '../lib/analytics';

const notice = document.querySelector<HTMLElement>('#analytics-notice');
const measurementId = notice?.dataset.measurementId;
// A production artifact may be served on staging; keep its GA4 tag on the
// canonical origin even when consent was previously granted on that browser.
const originAllowed = notice?.dataset.analyticsOrigin === location.origin;
const choiceKey = 'ajt.analytics-consent.v1';
const runKey = 'ajt.analytics-ci-run.v1';
let active = false;

function getRunId() {
  const current = analyticsRunId(location.href);
  try {
    if (current) sessionStorage.setItem(runKey, current);
    const stored = current || sessionStorage.getItem(runKey);
    return validAnalyticsRunId(stored) ? stored : undefined;
  } catch {
    return current;
  }
}

function getChoice() {
  try {
    return localStorage.getItem(choiceKey);
  } catch {
    return null;
  }
}
function saveChoice(choice: 'allowed' | 'denied') {
  try {
    localStorage.setItem(choiceKey, choice);
  } catch {
    /* Current-page choice still works. */
  }
}
function clearAnalyticsCookies() {
  const domains = location.hostname
    .split('.')
    .map((_, index, parts) => parts.slice(index).join('.'));
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (name !== '_ga' && !name.startsWith('_ga_')) continue;
    const expiry = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
    document.cookie = expiry;
    for (const domain of domains)
      document.cookie = `${expiry}; Domain=${domain}`;
  }
}
function enableAnalytics() {
  if (
    active ||
    !originAllowed ||
    !measurementId ||
    !/^G-[A-Z0-9]+$/.test(measurementId)
  )
    return;
  active = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  window.gtag('js', new Date());
  const runId = getRunId();
  window.gtag('config', measurementId, {
    page_location: analyticsLocation(location.href),
    page_referrer: analyticsReferrer(document.referrer, location.origin),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_expires: 60 * 60 * 24 * 90,
    cookie_flags: 'SameSite=Lax;Secure',
    ...(runId ? { user_properties: { ci_run_id: runId } } : {}),
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.append(script);
}

if (!originAllowed) {
  document
    .querySelectorAll<HTMLElement>('[data-open-analytics-preferences]')
    .forEach((button) => {
      button.hidden = true;
    });
}

if (notice && measurementId && originAllowed) {
  const privacySignal =
    navigator.doNotTrack === '1' ||
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true;
  if (!privacySignal && getChoice() === 'allowed') enableAnalytics();
  else if (!privacySignal && getChoice() !== 'denied') notice.hidden = false;

  document
    .querySelectorAll('[data-open-analytics-preferences]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        notice.hidden = false;
        notice
          .querySelector<HTMLButtonElement>('[data-analytics-allow]')
          ?.focus();
      });
    });
  notice
    .querySelector('[data-analytics-allow]')
    ?.addEventListener('click', () => {
      saveChoice('allowed');
      notice.hidden = true;
      if (!privacySignal) enableAnalytics();
    });
  notice
    .querySelector('[data-analytics-deny]')
    ?.addEventListener('click', () => {
      saveChoice('denied');
      try {
        sessionStorage.removeItem(runKey);
      } catch {
        /* Storage may be unavailable. No analytics is sent after withdrawal. */
      }
      notice.hidden = true;
      clearAnalyticsCookies();
      if (active) {
        (window as unknown as Record<string, unknown>)[
          `ga-disable-${measurementId}`
        ] = true;
        location.reload();
      }
    });
}
