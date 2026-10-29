import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setupGitHub, repository } from './setup-github.mjs';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ajt-github-setup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bindings = {
    B2_MEDIA_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
    B2_MEDIA_BUCKET: 'ajt-test-media',
    B2_MEDIA_KEY_ID: 'readonlytestkey',
    B2_MEDIA_APPLICATION_KEY: 'fake-media-secret',
  };
  await fs.writeFile(
    path.join(root, '.dev.vars'),
    Object.entries(bindings)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    { mode: 0o600 },
  );
  const protectionRules = [
    { type: 'branch_policy' },
    {
      type: 'required_reviewers',
      prevent_self_review: true,
      reviewers: [{ type: 'User', reviewer: { id: 1 } }],
    },
  ];
  const state = {
    repo: {
      full_name: repository,
      private: true,
      permissions: { admin: true },
    },
    environment: {
      deployment_branch_policy: {
        custom_branch_policies: true,
        protected_branches: false,
      },
      protection_rules: protectionRules,
    },
    policies: [],
    repoSecrets: new Set(['B2_MEDIA_KEY_ID', 'B2_MEDIA_APPLICATION_KEY']),
    envSecrets: new Set(),
    calls: [],
    ...options,
  };
  const gh = (args, opts = {}) => {
    state.calls.push({ args: [...args], ...opts });
    if (args[0] === 'api') {
      if (args.includes('--paginate'))
        return JSON.stringify([{ branch_policies: state.policies }]);
      const method = args[args.indexOf('--method') + 1];
      const endpoint = args[args.indexOf('--method') + 2];
      if (method === 'GET' && endpoint === `repos/${repository}`)
        return JSON.stringify(state.repo);
      if (method === 'GET')
        return state.environment ? JSON.stringify(state.environment) : null;
      if (method === 'POST')
        state.policies.push({ id: 1, ...JSON.parse(opts.input) });
      else if (method === 'PUT') state.environment = JSON.parse(opts.input);
      return '{}';
    }
    if (args[0] === 'secret' && args[1] === 'list')
      return JSON.stringify(
        [
          ...(args.includes('--env') ? state.envSecrets : state.repoSecrets),
        ].map((name) => ({ name })),
      );
    if (args[0] === 'secret' && args[1] === 'set') {
      assert(args.includes('--env'));
      if (args[2] !== state.omitSecret) state.envSecrets.add(args[2]);
    }
    if (args[0] === 'secret' && args[1] === 'delete')
      state.repoSecrets.delete(args[2]);
    return '';
  };
  return { root, state, gh, bindings };
}

const mutations = (state) =>
  state.calls.filter(
    ({ args }) =>
      args.includes('POST') ||
      args.includes('PUT') ||
      args[1] === 'set' ||
      args[1] === 'delete',
  );

test('GitHub setup audits without writes, then migrates only after verified main-only protection and is repeatable', async (t) => {
  const { root, state, gh, bindings } = await fixture(t);
  const protections = structuredClone(state.environment.protection_rules);
  const audit = await setupGitHub({ root, env: {}, gh });
  assert.equal(audit.mode, 'audit');
  assert.equal(mutations(state).length, 0);
  const applied = await setupGitHub({ root, env: {}, gh, apply: true });
  assert.deepEqual(applied.allowedRefs, [{ name: 'main', type: 'branch' }]);
  assert.equal(applied.cloudflareTokenConfigured, false);
  assert.equal(state.repoSecrets.size, 0);
  assert.deepEqual(state.environment.protection_rules, protections);
  assert(!state.calls.some(({ args }) => args.includes('PUT')));
  const firstSecret = state.calls.findIndex(
    ({ args }) => args[1] === 'set' && args[0] === 'secret',
  );
  const branchCreation = state.calls.findIndex(({ args }) =>
    args.includes('POST'),
  );
  assert(branchCreation < firstSecret);
  const firstDelete = state.calls.findIndex(({ args }) => args[1] === 'delete');
  assert(
    state.calls
      .slice(firstSecret, firstDelete)
      .some(({ args }) => args[1] === 'list' && args.includes('--env')),
  );
  for (const secret of [
    bindings.B2_MEDIA_KEY_ID,
    bindings.B2_MEDIA_APPLICATION_KEY,
  ]) {
    assert(
      !JSON.stringify(state.calls.map(({ args }) => args)).includes(secret),
    );
    assert(!JSON.stringify(applied).includes(secret));
  }
  await setupGitHub({ root, env: {}, gh, apply: true });
  assert.equal(
    state.calls.filter(({ args }) => args.includes('POST')).length,
    1,
  );
});

test('a missing environment is created and restricted before the first secret write', async (t) => {
  const { root, state, gh } = await fixture(t, { environment: null });
  const applied = await setupGitHub({ root, env: {}, gh, apply: true });
  const puts = state.calls.filter(({ args }) => args.includes('PUT'));
  assert.equal(puts.length, 1);
  const creation = state.calls.findIndex(({ args }) => args.includes('PUT'));
  const policy = state.calls.findIndex(({ args }) => args.includes('POST'));
  const secret = state.calls.findIndex(
    ({ args }) => args[0] === 'secret' && args[1] === 'set',
  );
  assert(creation < policy && policy < secret);
  assert.deepEqual(applied.allowedRefs, [{ name: 'main', type: 'branch' }]);
});

test('migration retains repository copies when target secret storage cannot be verified', async (t) => {
  const { root, state, gh } = await fixture(t, {
    omitSecret: 'B2_MEDIA_APPLICATION_KEY',
  });
  await assert.rejects(
    setupGitHub({ root, env: {}, gh, apply: true }),
    /copies were retained/,
  );
  assert.equal(state.repoSecrets.size, 2);
  assert(!state.calls.some(({ args }) => args[1] === 'delete'));
});

test('unexpected repository access and broader branch/tag rules fail before any mutation', async (t) => {
  for (const options of [
    {
      repo: {
        full_name: repository,
        private: false,
        permissions: { admin: true },
      },
    },
    {
      repo: {
        full_name: repository,
        private: true,
        permissions: { admin: false },
      },
    },
    { policies: [{ id: 1, name: 'main', type: 'tag' }] },
    { policies: [{ id: 1, name: '*', type: 'branch' }] },
    { environment: { deployment_branch_policy: null } },
  ]) {
    const { root, state, gh } = await fixture(t, options);
    await assert.rejects(setupGitHub({ root, env: {}, gh, apply: true }));
    assert.equal(mutations(state).length, 0);
  }
});

test('Cloudflare token input is optional, never copied from GitHub/OAuth, and never placed in arguments or reports', async (t) => {
  const { root, state, gh } = await fixture(t);
  state.repoSecrets.add('CLOUDFLARE_API_TOKEN');
  await assert.rejects(
    setupGitHub({ root, env: {}, gh, apply: true }),
    /cannot return the repository token/,
  );
  assert.equal(mutations(state).length, 0);
  const token = 'fake-cloudflare-token-for-testing';
  const applied = await setupGitHub({
    root,
    env: { CLOUDFLARE_API_TOKEN: token },
    gh,
    apply: true,
  });
  assert(applied.cloudflareTokenConfigured);
  assert(!state.repoSecrets.has('CLOUDFLARE_API_TOKEN'));
  const transfer = state.calls.find(
    ({ args }) => args[1] === 'set' && args[2] === 'CLOUDFLARE_API_TOKEN',
  );
  assert.equal(transfer.input, token);
  assert(!JSON.stringify(state.calls.map(({ args }) => args)).includes(token));
  assert(!JSON.stringify(applied).includes(token));
});

test('interactive token prompting and CI misuse fail closed before touching GitHub', async (t) => {
  const { root, state, gh } = await fixture(t);
  await assert.rejects(
    setupGitHub({
      root,
      env: {},
      gh,
      apply: true,
      promptCloudflare: true,
      interactive: false,
    }),
    /interactive terminal/,
  );
  await assert.rejects(
    setupGitHub({ root, env: { GITHUB_ACTIONS: 'true' }, gh, apply: true }),
    /locally/,
  );
  assert.equal(state.calls.length, 0);
});
