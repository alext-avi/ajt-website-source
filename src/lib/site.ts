const email = (import.meta.env.PUBLIC_CONTACT_EMAIL || 'alext@avi.com').trim();
const linkedin = (
  import.meta.env.PUBLIC_LINKEDIN_URL ||
  'https://www.linkedin.com/in/alexander-jt/'
).trim();

export const site = {
  name: 'Alexander Thomas',
  title: 'Technology leadership. Engineering depth.',
  description:
    'Alexander Thomas is a CTO, engineering leader, software architect, and applied AI practitioner. Nearly 20 years of building software and leading the people behind it.',
  github: 'https://github.com/alext-avi',
  email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
  linkedin:
    linkedin && /^https:\/\/(www\.)?linkedin\.com\/in\/[^\s]+$/.test(linkedin)
      ? linkedin
      : undefined,
};

export const nav = [
  { href: '/about/', label: 'About' },
  { href: '/projects/', label: 'Projects' },
  { href: '/writing/', label: 'Writing' },
  { href: '/speaking/', label: 'Speaking' },
];

export function contactHref(subject?: string) {
  return site.email
    ? `mailto:${site.email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`
    : site.github;
}
