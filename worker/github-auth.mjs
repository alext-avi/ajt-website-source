import {
  AuthorizationError,
  authorizationErrorRedirect,
} from '@cloudflare/workers-oauth-provider';
import { createHash, randomBytes } from 'node:crypto';
import { escapeHtml as e } from '../mcp/content-render.mjs';

const page = (html, headers = {}, redirectOrigin = '') =>
  new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect website authoring</title><style>body{font:16px system-ui;background:#091321;color:#f5f6f8;max-width:640px;margin:10vh auto;padding:24px;line-height:1.6}button{padding:12px 20px;background:#d7b66f;border:0;border-radius:5px;color:#091321;font:inherit}code{overflow-wrap:anywhere}</style>${html}</html>`,
    {
      headers: {
        ...Object.fromEntries(new Headers(headers)),
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com ${redirectOrigin}; frame-ancestors 'none'; base-uri 'none'`,
      },
    },
  );

export async function githubAuthorize(
  request,
  env,
  oauth,
  { fetcher = fetch } = {},
) {
  const url = new URL(request.url);
  try {
    if (url.pathname === '/authorize' && request.method === 'GET') {
      const auth = await oauth.parseAuthRequest(request);
      // Request a narrow, explicit grant. Publish remains an App-only action on
      // this owner's connection; a host must enforce the visibility boundary.
      const consent = await oauth.beginConsent(auth);
      const details = await oauth.describeConsent(auth);
      return page(
        `<h1>Connect website authoring</h1><p><strong>${e(details.clientName)}</strong> is requesting access to your website drafts and media.</p><p>Only Alexander Thomas’s GitHub account is allowed. Publishing requires your Post click in the rendered App.</p><p>Return address: <code>${e(new URL(auth.redirectUri).origin)}</code></p>${details.clientDomain ? `<p>Client domain: ${e(details.clientDomain)}</p>` : '<p>The client name is self-reported.</p>'}${details.isLocalClient ? '<p>This connects an application on your computer.</p>' : ''}<form method="post" action="/authorize"><input type="hidden" name="handle" value="${e(consent.handle)}"><button name="decision" value="allow">Continue with GitHub</button> <button name="decision" value="deny">Cancel</button></form>`,
        consent.headers,
        new URL(auth.redirectUri).origin,
      );
    }
    if (url.pathname === '/authorize' && request.method === 'POST') {
      if (request.headers.get('origin') !== env.AUTHORING_ORIGIN)
        return new Response('Same-origin approval required', { status: 403 });
      const form = await request.formData();
      const handle = String(form.get('handle') || '');
      if (form.get('decision') !== 'allow') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle, {
        scope: ['content:read', 'content:write', 'offline_access'],
      });
      const verifier = randomBytes(32).toString('base64url');
      const upstream = await oauth.beginUpstream(approved.request, {
        data: { verifier },
        headers: approved.headers,
      });
      const github = new URL('https://github.com/login/oauth/authorize');
      github.search = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: env.AUTHORING_ORIGIN + '/callback',
        state: upstream.state,
        scope: '',
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      upstream.headers.set('Location', github.href);
      return new Response(null, { status: 302, headers: upstream.headers });
    }
    if (url.pathname === '/callback' && request.method === 'GET') {
      const state = await oauth.finishUpstream(request);
      const deny = () => {
        state.headers.set(
          'Location',
          authorizationErrorRedirect(state.request, 'access_denied'),
        );
        return new Response(null, { status: 302, headers: state.headers });
      };
      const code = url.searchParams.get('code');
      if (url.searchParams.has('error') || !code || code.length > 1024)
        return deny();
      const exchange = await fetcher(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: env.AUTHORING_ORIGIN + '/callback',
            code_verifier: state.data.verifier,
          }),
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!exchange.ok) return deny();
      const token = await exchange.json();
      if (typeof token.access_token !== 'string') return deny();
      const response = await fetcher('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ajt-content',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return deny();
      const user = await response.json();
      if (
        !Number.isSafeInteger(user.id) ||
        String(user.id) !== env.OWNER_GITHUB_ID
      )
        return deny();
      // GitHub's token is used only to verify identity. Never forward it to the
      // model, browser, MCP client, database, or logs.
      const completed = await oauth.completeAuthorization({
        request: state.request,
        userId: String(user.id),
        metadata: { label: 'Alexander Thomas' },
        scope: state.request.scope,
        props: { userId: String(user.id) },
      });
      state.headers.set('Location', completed.redirectTo);
      return new Response(null, { status: 302, headers: state.headers });
    }
    return new Response('Not found', { status: 404 });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo)
      return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError)
      return page(
        '<h1>Connection expired</h1><p>Please start the connection again from your MCP client.</p>',
      );
    return new Response('Sign-in is temporarily unavailable. Please retry.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
