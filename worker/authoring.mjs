import {
  OAuthAuthorizationServer,
  OAuthResourceServer,
  insufficientScope,
} from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod/v4';
import { createContentService } from '../mcp/content-service.mjs';
import { githubAuthorize } from './github-auth.mjs';
import { registerRemoteApp } from './remote-app.mjs';
import { remoteStore } from './remote-store.mjs';

export function authoringServer(env, overrides = {}) {
  const origin = new URL(env.AUTHORING_ORIGIN);
  if (
    origin.protocol !== 'https:' ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    !/^[0-9]+$/.test(env.OWNER_GITHUB_ID)
  )
    throw new Error('Invalid authoring identity configuration');
  const resource = origin.origin + '/mcp';
  const authorization = new OAuthAuthorizationServer({
    issuer: origin.origin,
    resources: [resource],
    defaultResource: resource,
    scopesSupported: ['content:read', 'content:write', 'offline_access'],
    accessTokenTTL: 600,
    refreshTokenTTL: 30 * 86400,
    clientRegistrationEndpoint: '/oauth/register',
    clientRegistrationTTL: 86400,
    clientIdMetadataDocumentEnabled: true,
  });
  const protectedMcp = new OAuthResourceServer({
    resourceMetadata: { resource, authorization_servers: [origin.origin] },
    requiredScopes: ['content:read', 'content:write'],
    validateToken: () => (resource, token) =>
      authorization.validateToken(resource, token, env),
    handler: {
      async fetch(request, env, ctx) {
        if (
          ctx.auth.userId !== env.OWNER_GITHUB_ID ||
          ctx.props.userId !== env.OWNER_GITHUB_ID
        )
          return new Response('Forbidden', { status: 403 });
        if (!ctx.auth.scope.includes('content:read'))
          return insufficientScope(ctx.auth, ['content:read']);
        const store = overrides.store || remoteStore(env);
        const server = createContentService(store, {
          remote: true,
          async authorize(readOnly) {
            if (!readOnly && !ctx.auth.scope.includes('content:write'))
              throw new Error('content:write permission is required');
          },
          registerAuthoringApp: registerRemoteApp(env, ctx.auth.userId),
          uploadSchema: z
            .object({
              name: z.string().min(1).max(200),
              data: z
                .string()
                .min(4)
                .max(700_000)
                .regex(/^[A-Za-z0-9+/]+={0,2}$/),
            })
            .strict(),
          uploadMediaFile: async ({ name, data }) => {
            const bytes = Buffer.from(data, 'base64');
            if (bytes.toString('base64') !== data)
              throw new Error('Invalid base64');
            return store.saveMedia(bytes, name);
          },
          listMedia: async () => {
            const rows = await store.query(
              'SELECT url,kind,metadata_json FROM media_assets ORDER BY created_at DESC LIMIT 200',
            );
            return rows.map((row) => ({
              url: row.url,
              kind: row.kind,
              ...JSON.parse(row.metadata_json),
              pending: true,
            }));
          },
          createReview: async (item) => ({
            collection: item.collection || 'posts',
            item,
            status: 'awaiting-human-review',
            message: 'Open the authoring App to review and press Post.',
          }),
          ensureReviewServer: async () => {},
        });
        return createMcpHandler(() => server, { route: '/mcp' })(
          request,
          env,
          ctx,
        );
      },
    },
  });
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.origin !== origin.origin)
        return new Response('Invalid origin', { status: 421 });
      if (url.pathname === '/health' && request.method === 'GET')
        return Response.json(
          {
            service: 'ajt-content',
            authentication: 'github-oauth',
            publication: 'direct-d1',
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.OAUTH_KV)
        return new Response('Authoring sign-in is not configured', {
          status: 503,
        });
      const callerOrigin = request.headers.get('origin');
      const allowed = [
        origin.origin,
        ...(env.ALLOWED_MCP_ORIGINS || '').split(',').filter(Boolean),
      ];
      if (callerOrigin && !allowed.includes(callerOrigin))
        return new Response('Origin not allowed', { status: 403 });
      const length = Number(request.headers.get('content-length') || 0);
      if (length > 1_000_000)
        return new Response('Request too large', { status: 413 });
      if (request.method === 'POST') {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request.body || []) {
          bytes += chunk.byteLength;
          if (bytes > 1_000_000)
            return new Response('Request too large', { status: 413 });
          chunks.push(Buffer.from(chunk));
        }
        request = new Request(request, { body: Buffer.concat(chunks) });
      }
      try {
        if (url.pathname === '/authorize' || url.pathname === '/callback')
          return (overrides.githubAuthorize || githubAuthorize)(
            request,
            env,
            authorization.getOAuthApi(env),
          );
        if (
          url.pathname === '/mcp' ||
          url.pathname.startsWith('/.well-known/oauth-protected-resource')
        )
          return protectedMcp.fetch(request, env, ctx);
        if (
          url.pathname.startsWith('/.well-known/') ||
          url.pathname.startsWith('/oauth/')
        )
          return authorization.fetch(request, env, ctx);
        return new Response('Not found', { status: 404 });
      } catch {
        return new Response('Authoring is temporarily unavailable', {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    },
  };
}
export default {
  fetch(request, env, ctx) {
    return authoringServer(env).fetch(request, env, ctx);
  },
};
