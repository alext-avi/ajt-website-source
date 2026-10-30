import { Marked } from 'marked';
import { parseFragment } from 'parse5';

const allowed = new Set(
  'p br hr a img h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code em strong del s table thead tbody tr th td caption sup sub details summary div span dl dt dd'.split(
    ' ',
  ),
);
export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ],
  );

export function renderMarkdown(body) {
  const headings = [];
  const ids = new Set();
  const renderer = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        function plainText(node) {
          return node.nodeName === '#text'
            ? node.value
            : (node.childNodes || []).map(plainText).join('');
        }
        const text = plainText(parseFragment(html));
        const base =
          text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'section';
        let slug = base;
        let count = 0;
        while (ids.has(slug)) slug = `${base}-${++count}`;
        ids.add(slug);
        headings.push({ depth, text, slug });
        return `<h${depth} id="${slug}">${html}</h${depth}>\n`;
      },
    },
  });
  const html = renderer.parse(body, { async: false });
  function check(node) {
    if (node.tagName && !allowed.has(node.tagName))
      throw new Error(
        'Use Markdown and media fields; active HTML is not allowed',
      );
    for (const { name, value } of node.attrs || []) {
      if (
        /^on/i.test(name) ||
        ['srcdoc', 'style', 'formaction', 'srcset', 'background'].includes(name)
      )
        throw new Error('Executable HTML attributes are not allowed');
      if (
        ['href', 'src', 'xlink:href'].includes(name) &&
        !['https:', 'http:', 'mailto:', 'tel:'].includes(
          new URL(value, 'https://content.test/').protocol,
        )
      )
        throw new Error('Unsafe link or media protocol');
    }
    for (const child of node.childNodes || []) check(child);
  }
  check(parseFragment(html));
  return { html, headings };
}
export async function postMedia(post) {
  const urls = ['image', 'videoPoster', 'video', 'slides']
    .map((field) => post.metadata[field])
    .filter((url) => url?.startsWith('/'));
  function visit(node) {
    for (const attr of node.attrs || [])
      if (
        ['href', 'src'].includes(attr.name) &&
        /^\/(uploads|videos|media)\//.test(attr.value)
      )
        urls.push(new URL(attr.value, 'https://content.test').pathname);
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parseFragment(renderMarkdown(post.body).html));
  return [...new Set(urls)];
}
