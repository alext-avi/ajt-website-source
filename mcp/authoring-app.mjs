import { App } from '@modelcontextprotocol/ext-apps';

const app = new App(
  { name: 'Website draft review', version: '1.2.0' },
  {},
  { autoResize: true },
);
const root = document.querySelector('#app');
// This template is static. Draft content is assigned through text/value properties.
root.innerHTML = `<header><div><p class="eyebrow">-AT · Website</p><h1>Review draft</h1></div></header>
<p class="notice">Review the website draft your agent prepared, make any edits, then press Post to publish it on your website.</p>
<p role="status" class="status" id="status">Connecting…</p>
<p id="empty" class="notice" hidden>Ask your agent to prepare or open a website draft.</p>
<div class="grid" hidden>
<section class="panel"><h2 id="editor-title">Editor</h2><p id="revision" class="meta"></p><div id="source" hidden><p class="notice">Original LinkedIn text and date are preserved. Website metadata and media remain editable.</p><details><summary>Original capture</summary><pre class="source" id="source-text"></pre></details></div><form id="editor"><fieldset id="fields">
<label>Title<input name="title" required minlength="5"></label><label>Summary<textarea name="summary" required minlength="20" maxlength="300" rows="3"></textarea></label>
<div data-type="posts"><div class="two"><label>Publication date<input name="date" type="date"></label><label>Category<select name="category"><option>Applied AI</option><option>Engineering leadership</option><option>Architecture</option><option>Developer tools</option><option>Events &amp; reflections</option></select></label></div></div>
<div data-type="projects"><label>My role<input name="role"></label><label>Tools &amp; disciplines<input name="technologies" placeholder="Separate items with commas"></label><label>Selected outcomes<textarea name="outcomes" rows="3" placeholder="One supported outcome per line"></textarea></label><label>Repository URL<input name="repository" type="url"></label><label>Related article slugs<textarea name="relatedArticles" rows="2"></textarea></label><div class="two"><label>Illustration<select name="kind"><option>systems</option><option>agents</option><option>mobile</option><option>platform</option></select></label><label>Display order<input name="order" type="number" step="any" value="0"></label></div></div>
<label>Tags<input name="tags" placeholder="Separate tags with commas"></label><label><input name="featured" type="checkbox">Featured</label><label>Body (Markdown)<textarea name="body" rows="15" required></textarea></label>
<details class="section"><summary>Media and uploads</summary><label>Cover image<input name="image" placeholder="Select from the library or upload"></label><label>Cover image description<input name="imageAlt"></label><div data-type="posts"><label>Video<input name="video"></label><label>Video poster<input name="videoPoster"></label></div><div class="two"><label>Use upload as<select id="upload-target"><option value="image">Cover image</option><option value="video">Video</option><option value="videoPoster">Video poster</option><option value="inline">Inline image or PDF</option></select></label><label>Upload / replace<input id="upload" type="file" accept="image/png,image/jpeg,image/gif,image/webp"></label></div><p class="notice">Uploads stay private. Browser uploads support files up to 25 MiB.</p><label>Find media<input id="media-search" type="search"></label><button type="button" id="browse">Browse media library</button><div class="library" id="media"></div></details>
<div class="actions section"><button class="primary" id="save" type="button">Save draft</button><button id="discard" type="button">Reload saved draft</button></div></fieldset></form></section>
<section class="panel preview-panel"><header><h2>Saved draft preview</h2><button id="preview" type="button">Refresh preview</button></header><p class="notice">Post publishes the saved draft to your website. It does not post to LinkedIn.</p><p id="preview-status" class="notice" aria-live="polite"></p><iframe class="preview" title="Saved draft preview" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe><p id="publication-context" class="notice" role="alert" hidden></p><div class="actions section"><button class="primary" id="post" type="button">Post</button><button id="review" type="button">Open draft</button><a id="draft-link" hidden target="_blank" rel="noopener noreferrer">Open draft in publishing desk ↗</a><input id="draft-address" aria-label="Draft address" readonly hidden></div></section></div>`;
const $ = (selector) => root.querySelector(selector);
const field = (name) => $('#editor').elements.namedItem(name);
const status = (message) => {
  $('#status').textContent = message;
};
let collection = 'posts';
let current;
let dirty = false;
let busy = false;
const blobs = new Map();
let previewBytes = 0;
let previewDocument;
let previewToken;
let publicationBlocked = false;
let tornDown = false;
const dataFields = [
  'title',
  'summary',
  'tags',
  'image',
  'imageAlt',
  'featured',
];
const postFields = ['date', 'category', 'video', 'videoPoster'];
const projectFields = [
  'role',
  'technologies',
  'outcomes',
  'repository',
  'relatedArticles',
  'order',
  'kind',
];

async function tool(name, args) {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError)
    throw new Error(
      result.content?.find((block) => block.type === 'text')?.text ||
        'The operation failed',
    );
  return result.structuredContent;
}
function controls() {
  const saved = !!current;
  const editable = saved && current.metadata.draft;
  $('#fields').disabled = busy || !editable;
  $('#save').disabled = busy || !editable;
  $('#review').disabled = busy || !saved || dirty || !current.metadata.draft;
  $('#post').disabled =
    busy ||
    !saved ||
    dirty ||
    !current.metadata.draft ||
    !previewToken ||
    publicationBlocked;
  $('#preview').disabled = busy || !saved || dirty;
  $('#discard').disabled = busy || !saved;
}
function configure() {
  for (const section of root.querySelectorAll('[data-type]'))
    section.hidden = section.dataset.type !== collection;
  field('date').required = collection === 'posts';
  field('role').required = collection === 'projects';
  for (const option of $('#upload-target').options)
    option.disabled =
      collection === 'projects' &&
      ['video', 'videoPoster'].includes(option.value);
  if ($('#upload-target').selectedOptions[0].disabled)
    $('#upload-target').value = 'image';
  $('#editor-title').textContent =
    collection === 'projects' ? 'Project editor' : 'Post editor';
}
function setItem(item, kind = item.collection || 'posts') {
  collection = kind;
  current = item;
  previewToken = undefined;
  publicationBlocked = false;
  $('#draft-link').hidden = true;
  $('#draft-address').hidden = true;
  $('#publication-context').hidden = true;
  $('#empty').hidden = true;
  $('.grid').hidden = false;
  $('#editor').reset();
  for (const name of [
    ...dataFields,
    ...(kind === 'posts' ? postFields : projectFields),
  ]) {
    const input = field(name);
    const value = item.metadata[name];
    if (input.type === 'checkbox') input.checked = !!value;
    else
      input.value = Array.isArray(value)
        ? value.join(
            ['outcomes', 'relatedArticles'].includes(name) ? '\n' : ', ',
          )
        : name === 'date'
          ? (value || '').slice(0, 10)
          : (value ?? '');
  }
  field('body').value = item.body;
  const source = item.linkedinSource;
  field('body').readOnly = !!source;
  field('date').readOnly = !!source;
  $('#source').hidden = !source;
  $('#source-text').textContent = source?.text || '';
  $('#upload-target option[value="inline"]').disabled = !!source;
  $('#revision').textContent =
    `Revision ${item.revision} · ${item.metadata.draft ? 'Draft' : 'Published — read only'}`;
  dirty = false;
  configure();
  controls();
}
function unsaved() {
  if (!dirty) return false;
  status('Save or reload your current changes before opening another draft.');
  return true;
}
function changed() {
  dirty = true;
  controls();
  previewToken = undefined;
  status('Unsaved changes. Save to refresh the preview before posting.');
}
function emptyState() {
  current = undefined;
  previewToken = undefined;
  $('.grid').hidden = true;
  $('#empty').hidden = false;
  if (previewDocument) URL.revokeObjectURL(previewDocument);
  $('.preview').removeAttribute('src');
  dirty = false;
  controls();
  status('Waiting for a draft from your agent.');
}
async function mediaBlob(url) {
  if (blobs.has(url)) return blobs.get(url);
  const chunks = [];
  let cursor = 0;
  let total;
  do {
    const part = await tool('read_authoring_media', { url, offset: cursor });
    total = part.totalBytes;
    if (previewBytes + total > 32 * 1024 * 1024)
      throw new Error('Use Open draft to view additional large media.');
    const raw = atob(part.data);
    if (!raw.length || part.offset !== cursor)
      throw new Error('Incomplete media preview');
    chunks.push(Uint8Array.from(raw, (ch) => ch.charCodeAt(0)));
    cursor += raw.length;
    if (part.mimeType.startsWith('video/'))
      $('#preview-status').textContent =
        `Loading video preview ${Math.round((cursor / total) * 100)}%…`;
    if (cursor === total) {
      // MCP hosts allow data: media by default; blob: media is not implicit.
      // The preview document itself stays in the explicitly allowed blob frame.
      const value = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () =>
          reject(new Error('Could not prepare private media.'));
        reader.readAsDataURL(new Blob(chunks, { type: part.mimeType }));
      });
      blobs.set(url, value);
      previewBytes += total;
      return value;
    }
  } while (cursor < total);
}
async function preview() {
  if (!current || dirty) return;
  previewToken = undefined;
  $('#preview-status').textContent = 'Loading saved content and media…';
  const result = await tool('render_authoring_preview', {
    collection,
    slug: current.slug,
    expectedRevision: current.revision,
  });
  const context = $('#publication-context');
  context.textContent =
    current.metadata.draft && !result.previewToken
      ? 'Posting is unavailable because this authoring connection needs to reload. Fully quit Codex, reopen it, and open this draft again. Nothing has been posted.'
      : result.publicationTarget === 'local-test'
        ? 'Local test mode. Post cannot publish to the live website.'
        : 'Post publishes this saved draft to the live website.';
  context.hidden = false;
  const doc = new DOMParser().parseFromString(result.html, 'text/html');
  // Keep attached post videos after the text, as on the final review page.
  // Also normalize previews from an already-running older MCP renderer.
  if (collection === 'posts') {
    const article = doc.querySelector('body > article.prose');
    const video = doc.querySelector('body > figure.app-video');
    if (article && video) article.after(video);
  }
  let warning = '';
  for (const node of [
    ...doc.querySelectorAll('img[src],video[poster],source[src]'),
  ].slice(0, 10)) {
    const attribute = node.tagName === 'VIDEO' ? 'poster' : 'src';
    const url = node.getAttribute(attribute);
    node.removeAttribute(attribute);
    if (!result.assets.includes(url)) continue;
    try {
      node.setAttribute(attribute, await mediaBlob(url));
    } catch (error) {
      warning = error.message;
    }
  }
  // Unprocessed and external URLs are inert under the preview's restrictive CSP.
  if (previewDocument) URL.revokeObjectURL(previewDocument);
  previewDocument = URL.createObjectURL(
    new Blob(['<!doctype html>' + doc.documentElement.outerHTML], {
      type: 'text/html',
    }),
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error('The preview could not load. Refresh it before posting.'),
        ),
      10_000,
    );
    $('.preview').onload = () => {
      clearTimeout(timeout);
      const player = $('.preview').contentDocument?.querySelector('video');
      player?.addEventListener('error', () => {
        $('#preview-status').textContent =
          'Video playback failed in this host. Use Open draft to check it in your browser.';
      });
      previewToken = result.previewToken;
      resolve();
    };
    $('.preview').src = previewDocument;
  });
  $('#preview-status').textContent =
    warning ||
    (doc.querySelector('video')
      ? 'Play the video here using its controls.'
      : '');
}
function metadata() {
  const result = {};
  for (const name of [
    ...dataFields,
    ...(collection === 'posts' ? postFields : projectFields),
  ]) {
    const input = field(name);
    const value = input.value.trim();
    result[name] =
      input.type === 'checkbox'
        ? input.checked
        : ['tags', 'technologies'].includes(name)
          ? value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : ['outcomes', 'relatedArticles'].includes(name)
            ? value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            : name === 'order'
              ? Number(value)
              : value ||
                (current &&
                [
                  'image',
                  'imageAlt',
                  'video',
                  'videoPoster',
                  'repository',
                ].includes(name)
                  ? null
                  : undefined);
  }
  return result;
}
async function save(event) {
  event.preventDefault();
  if (!current) return;
  if (!$('#editor').reportValidity()) return;
  await run(async () => {
    const singular = collection === 'posts' ? 'post' : 'project';
    const result = await tool(`update_${singular}_draft`, {
      slug: current.slug,
      expectedRevision: current.revision,
      metadata: metadata(),
      body: field('body').value,
    });
    setItem(await tool(`get_${singular}`, { slug: result.slug }), collection);
    await preview();
    status('Draft saved. Check the preview, then press Post when ready.');
  });
}
async function run(action) {
  if (busy) return;
  busy = true;
  controls();
  try {
    await action();
  } catch (error) {
    status(error.message || 'The operation failed.');
  } finally {
    busy = false;
    controls();
  }
}
function attach(url, kind) {
  const target = $('#upload-target').value;
  if (kind === 'document' || target === 'inline') {
    if (field('body').readOnly) {
      status(
        'Media is in your private library. The original LinkedIn body stays unchanged.',
      );
      return;
    }
    field('body').value +=
      `\n\n${kind === 'document' ? '[View document]' : '![Describe this image]'}(${url})\n`;
  } else
    field(target === 'video' || kind === 'video' ? 'video' : target).value =
      url;
  changed();
}
async function browse() {
  const result = await tool('list_media', {
    query: $('#media-search').value,
    limit: 50,
  });
  $('#media').replaceChildren();
  for (const item of result.media) {
    if (collection === 'projects' && item.kind === 'video') continue;
    const row = document.createElement('div');
    row.className = 'asset';
    const text = document.createElement('div');
    text.textContent = `${item.name || item.url.split('/').at(-1)} · ${item.kind}${item.pending ? ' · private' : ''}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Use this media';
    button.onclick = () => attach(item.url, item.kind);
    row.append(text, button);
    $('#media').append(row);
  }
}
function base64(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
$('#upload').onchange = () =>
  run(async () => {
    const file = $('#upload').files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024 || !file.size)
      throw new Error('Choose a file between 1 byte and 25 MiB.');
    const upload = await tool('begin_authoring_upload', {
      name: file.name,
      bytes: file.size,
    });
    for (
      let position = 0;
      position < file.size;
      position += upload.chunkBytes
    ) {
      const bytes = new Uint8Array(
        await file.slice(position, position + upload.chunkBytes).arrayBuffer(),
      );
      await tool('append_authoring_upload', {
        uploadId: upload.uploadId,
        offset: position,
        data: base64(bytes),
      });
      status(
        `Uploading ${Math.min(100, Math.round(((position + bytes.length) / file.size) * 100))}%`,
      );
    }
    const result = await tool('finish_authoring_upload', {
      uploadId: upload.uploadId,
    });
    attach(result.url, result.kind);
    status('Upload ready. Save the draft to refresh its preview.');
    $('#upload').value = '';
  });
$('#upload-target').onchange = () => {
  $('#upload').accept =
    $('#upload-target').value === 'video'
      ? 'video/mp4'
      : $('#upload-target').value === 'inline'
        ? 'image/png,image/jpeg,image/gif,image/webp,application/pdf'
        : 'image/png,image/jpeg,image/gif,image/webp';
};
$('#editor').onsubmit = save;
// MCP hosts may prohibit native form submission. Saves travel over tool RPC.
$('#save').onclick = save;
$('#editor').addEventListener('input', (event) => {
  if (!['upload', 'media-search', 'upload-target'].includes(event.target.id))
    changed();
});
$('#browse').onclick = () => run(browse);
$('#preview').onclick = () => run(preview);
$('#discard').onclick = () =>
  run(async () => {
    if (!current) return;
    setItem(
      await tool(collection === 'posts' ? 'get_post' : 'get_project', {
        slug: current.slug,
      }),
      collection,
    );
    await preview();
    status('Reloaded the latest saved revision.');
  });
function draftLink(url) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/review\/[a-f0-9]{48}$/.test(url))
    throw new Error('Invalid local draft link.');
  $('#draft-link').href = url;
  $('#draft-address').value = url;
  $('#draft-link').hidden = false;
}
$('#review').onclick = () =>
  run(async () => {
    if (dirty || !current) return;
    const review = await tool(
      collection === 'posts'
        ? 'submit_post_for_review'
        : 'submit_project_for_review',
      { slug: current.slug, expectedRevision: current.revision },
    );
    draftLink(review.reviewUrl);
    try {
      const result = await app.openLink({ url: review.reviewUrl });
      if (result.isError) throw new Error('Link opening was declined.');
      status('Draft opened in the local publishing desk.');
    } catch {
      $('#draft-address').hidden = false;
      status(
        'This host could not open the local desk. Use the draft link, or copy the draft address into your browser.',
      );
    }
  });
$('#post').onclick = (event) => {
  // Publication is never triggered by tool delivery, rendering, or a script click.
  if (
    !event.isTrusted ||
    dirty ||
    !current ||
    !previewToken ||
    publicationBlocked
  )
    return;
  const token = previewToken;
  publicationBlocked = true;
  void run(async () => {
    try {
      let result = await tool('publish_authoring_draft', {
        previewToken: token,
      });
      while (!tornDown) {
        status(result.message || 'Posting…');
        if (result.reviewUrl) draftLink(result.reviewUrl);
        if (result.status !== 'publishing') break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (tornDown) return;
        result = await tool('get_authoring_publication_status', {
          previewToken: token,
        });
      }
      if (result.status === 'posted') {
        const message = result.message;
        setItem(
          await tool(collection === 'posts' ? 'get_post' : 'get_project', {
            slug: current.slug,
          }),
          collection,
        );
        status(message);
      }
    } catch {
      status(
        'Posting status is unavailable. Open the draft to inspect its status before trying again.',
      );
    }
  });
};
app.ontoolresult = (result) =>
  run(async () => {
    if (unsaved()) return;
    const value = result.structuredContent;
    if (value?.item || value?.metadata) {
      const item = value.item || value;
      setItem(item, value.collection || item.collection || 'posts');
      await preview();
    } else {
      emptyState();
      return;
    }
    status('Ready. Draft changes stay private until you press Post.');
  });
app.onteardown = async () => {
  tornDown = true;
  if (previewDocument) URL.revokeObjectURL(previewDocument);
  blobs.clear();
  return {};
};
app
  .connect()
  .catch((error) =>
    status('Could not connect to the MCP host: ' + error.message),
  );
