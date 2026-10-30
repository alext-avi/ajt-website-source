import { authoringServer } from '../../worker/authoring.mjs';
import { githubAuthorize } from '../../worker/github-auth.mjs';

// This entrypoint is never deployed. Only GitHub's upstream identity exchange is
// replaced; OAuth consent/cookies/PKCE/tokens, MCP, D1 and publication are real.
export default {
  fetch(request, env, ctx) {
    // Test-only loopback gateway: both real Workers share one workerd/D1 owner.
    if (request.headers.get('X-AJT-Test-Public-Site') === '1') {
      const url = new URL(request.url);
      const target = new URL(
        url.pathname + url.search,
        'http://127.0.0.1:8801',
      );
      const headers = new Headers(request.headers);
      headers.delete('X-AJT-Test-Public-Site');
      return env.PUBLIC_SITE.fetch(
        new Request(target, { method: request.method, headers }),
      );
    }
    return authoringServer(env, {
      githubAuthorize: (request, env, oauth) =>
        githubAuthorize(request, env, oauth, {
          async fetcher(url, options) {
            if (url === 'https://github.com/login/oauth/access_token')
              return Response.json({
                access_token:
                  options.body.get('code') === 'fixture-owner'
                    ? 'owner'
                    : 'intruder',
              });
            if (url === 'https://api.github.com/user')
              return Response.json({
                id:
                  options.headers.Authorization === 'Bearer owner'
                    ? 13840761
                    : 999,
                login: 'fixture-user',
              });
            throw new Error('Unexpected identity request');
          },
        }),
    }).fetch(request, env, ctx);
  },
};
