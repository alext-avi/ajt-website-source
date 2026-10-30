import { authoringServer } from '../../worker/authoring.mjs';
import { githubAuthorize } from '../../worker/github-auth.mjs';

// This entrypoint is never deployed. Only GitHub's upstream identity exchange is
// replaced; OAuth consent/cookies/PKCE/tokens, MCP, D1 and publication are real.
export default {
  fetch(request, env, ctx) {
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
