import { parseFragment } from 'parse5';

type HTMLNode = {
  nodeName: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HTMLNode[];
};

export function anchorHrefs(html: string) {
  const links: string[] = [];
  function visit(node: HTMLNode) {
    if (node.nodeName === 'a') {
      const href = node.attrs?.find((attribute) => attribute.name === 'href');
      if (href) links.push(href.value);
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parseFragment(html));
  return links;
}
