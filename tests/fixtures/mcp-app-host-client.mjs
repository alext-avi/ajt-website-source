import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { PostMessageTransport } from '@modelcontextprotocol/ext-apps';

const frame = document.querySelector('iframe');
const calls = [];
window.testHost = { calls, opened: [] };
const bridge = new AppBridge(
  null,
  { name: 'AJT integration host', version: '1.0.0' },
  { serverTools: {}, openLinks: {} },
);
bridge.oncalltool = async (params) => {
  calls.push(params.name);
  const response = await fetch('/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const result = await response.json();
  if (
    params.name === 'render_authoring_preview' &&
    new URL(location.href).searchParams.has('oldConnection')
  ) {
    delete result.structuredContent.previewToken;
    delete result.structuredContent.publicationTarget;
  }
  return result;
};
bridge.onopenlink = async ({ url }) => {
  if (new URL(location.href).searchParams.has('denyOpen'))
    return { isError: true };
  window.testHost.opened.push(url);
  return { isError: false };
};
bridge.addEventListener('sizechange', ({ height }) => {
  if (Number.isFinite(height) && height > 0)
    frame.style.height = `${Math.min(height, 10_000)}px`;
});
// Test-only host delivery models an agent opening another prepared draft.
window.testHost.deliver = async (params) => {
  const response = await fetch('/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  await bridge.sendToolResult(await response.json());
};
bridge.oninitialized = async () => {
  await window.testHost.deliver({
    name: 'open_authoring_app',
    arguments: {
      collection:
        new URL(location.href).searchParams.get('collection') || 'posts',
      ...(new URL(location.href).searchParams.get('slug')
        ? { slug: new URL(location.href).searchParams.get('slug') }
        : {}),
    },
  });
};
await bridge.connect(
  new PostMessageTransport(frame.contentWindow, frame.contentWindow),
);
const html = await (await fetch('/app')).text();
frame.srcdoc = html;
