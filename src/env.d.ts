/// <reference types="astro/client" />
interface ImportMetaEnv {
  readonly PUBLIC_CONTACT_EMAIL?: string;
  readonly PUBLIC_LINKEDIN_URL?: string;
  readonly PUBLIC_KEYSTATIC_REPO?: string;
  readonly PUBLIC_GA4_MEASUREMENT_ID?: string;
}
interface Window {
  dataLayer: unknown[];
  gtag: (...args: unknown[]) => void;
}
