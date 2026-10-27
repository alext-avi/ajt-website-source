import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildMediaManifest } from '../../scripts/lib/media-manifest.mjs';
import { renderPost } from '../../mcp/reviews.mjs';

for (const backend of ['r2', 'b2'])
  test.describe(backend.toUpperCase() + ' media', () => {
    const state = path.resolve(
      '.wrangler/review-integration' + (backend === 'b2' ? '/b2' : ''),
    );
    const workerOrigin =
      backend === 'b2' ? 'http://127.0.0.1:8797' : 'http://127.0.0.1:8796';
    const reviewOrigin =
      backend === 'b2' ? 'http://127.0.0.1:4332' : 'http://127.0.0.1:4331';
    test.use({ baseURL: reviewOrigin });

    test('MCP uploads survive a lost cache; human approval and a release expose only referenced files through the real Worker', async ({
      page,
      request,
    }) => {
      const client = new Client({
        name: 'ajt-r2-integration',
        version: '1.0.0',
      });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [
            'mcp/content-server.mjs',
            '--local',
            '--database',
            path.join(state, 'content.sqlite'),
            backend === 'b2' ? '--local-b2' : '--local-r2',
            path.join(state, backend === 'b2' ? 'b2.json' : 'r2'),
          ],
          cwd: process.cwd(),
          env: {
            ...(process.env as Record<string, string>),
            AJT_REVIEW_ORIGIN: reviewOrigin,
            AJT_REVIEW_DIR: path.join(state, 'tickets'),
            AJT_MEDIA_DIR: path.join(state, 'media'),
          },
          stderr: 'pipe',
        }),
      );
      async function tool(name: string, args: object) {
        const result = await client.callTool({
          name,
          arguments: args as Record<string, unknown>,
        });
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        return JSON.parse(
          result.content.find((block) => block.type === 'text')!.text as string,
        );
      }
      try {
        const imagePath = path.resolve('public/images/videos/go-plant.jpg');
        const imageBytes = await fs.readFile(imagePath);
        const image = await tool('upload_media', { path: imagePath });
        expect(image.storage).toBe('local-' + backend);
        expect(
          (await tool('list_media', {})).media.some(
            (file: { url: string }) => file.url === image.url,
          ),
        ).toBe(true);
        expect(image.url).toBe(
          '/media/' +
            createHash('sha256').update(imageBytes).digest('hex') +
            '.jpg',
        );
        expect((await tool('upload_media', { path: imagePath })).url).toBe(
          image.url,
        );
        const pdfBytes = Buffer.from(
          '%PDF-1.4\n% Local integration document\n%%EOF',
        );
        const videoBytes = Buffer.concat([
          Buffer.from('00000018667479706d703432000000006d703432', 'hex'),
          Buffer.alloc(2048),
        ]);
        const pdfPath = path.join(state, 'test.pdf');
        const videoPath = path.join(state, 'test.mp4');
        const unusedPath = path.join(state, 'unused.jpg');
        await fs.writeFile(pdfPath, pdfBytes);
        await fs.writeFile(videoPath, videoBytes);
        await fs.writeFile(
          unusedPath,
          Buffer.concat([imageBytes, Buffer.from('unapproved private upload')]),
        );
        const pdf = await tool('upload_media', { path: pdfPath });
        const video = await tool('upload_media', { path: videoPath });
        const unused = await tool('upload_media', { path: unusedPath });
        expect((await request.get(workerOrigin + image.url)).status()).toBe(
          404,
        );
        // Reconstruct all referenced bytes from the isolated storage server, not the upload cache.
        await fs.rm(path.join(state, 'media/object-cache'), {
          recursive: true,
          force: true,
        });
        const slug = backend + '-human-approved';
        await tool('create_post_draft', {
          slug,
          metadata: {
            title: 'A human approved media round trip',
            summary:
              'An isolated integration draft exercising private object uploads and a human approved website release.',
            date: '2026-10-27',
            category: 'Architecture',
            image: image.url,
            imageAlt: 'An actual uploaded plant image',
            video: video.url,
          },
          body: `A rendered draft with a [PDF download](${pdf.url}).`,
        });
        const review = await tool('submit_post_for_review', {
          slug,
          expectedRevision: 1,
        });
        await page.goto('/review/' + review.id);
        const preview = page.frameLocator('iframe[title="Rendered draft"]');
        const previewImage = preview.getByAltText(
          'An actual uploaded plant image',
        );
        await expect(previewImage).toBeVisible();
        expect(
          await previewImage.evaluate(
            (image: HTMLImageElement) => image.naturalWidth,
          ),
        ).toBeGreaterThan(0);
        const privateImage = await request.get(image.url);
        expect(privateImage.status()).toBe(200);
        expect(privateImage.headers()['cache-control']).toBe('no-store');
        expect(await privateImage.body()).toEqual(imageBytes);
        const library = await tool('list_media', { query: image.url });
        expect(
          library.media.some(
            (file: { url: string; pending: boolean }) =>
              file.url === image.url && file.pending,
          ),
        ).toBe(true);
        expect((await tool('get_post', { slug })).metadata.draft).toBe(true);
        await page
          .getByRole('button', { name: 'Publish', exact: true })
          .click();
        await expect(page.getByRole('status')).toContainText(
          'Approved in the local test database',
        );
        const approved = await tool('get_post', { slug });
        expect(approved.metadata.draft).toBe(false);
        // A release is a separate step: approval alone does not expose an uploaded object.
        expect((await request.get(workerOrigin + image.url)).status()).toBe(
          404,
        );
        const site = path.join(state, 'site');
        await fs.writeFile(
          path.join(site, 'index.html'),
          `<img src="${approved.metadata.image}"><video src="${approved.metadata.video}"></video>${await renderPost(approved.body)}`,
        );
        const manifest = await buildMediaManifest(site);
        expect(manifest.files).toHaveLength(3);
        expect(manifest.files).not.toContain(unused.url.split('/').at(-1));
        await expect
          .poll(
            async () => (await request.get(workerOrigin + image.url)).status(),
            { timeout: 30_000 },
          )
          .toBe(200);
        for (const [media, bytes, contentType] of [
          [image, imageBytes, 'image/jpeg'],
          [pdf, pdfBytes, 'application/pdf'],
        ] as const) {
          const response = await request.get(workerOrigin + media.url);
          expect(response.status()).toBe(200);
          expect(response.headers()['content-type']).toBe(contentType);
          expect(response.headers()['x-content-type-options']).toBe('nosniff');
          expect(response.headers()['cache-control']).toContain('immutable');
          expect(await response.body()).toEqual(bytes);
          const head = await request.head(workerOrigin + media.url);
          expect(head.status()).toBe(200);
          expect(head.headers()['content-length']).toBe(String(bytes.length));
          const cached = await request.get(workerOrigin + media.url, {
            headers: { 'If-None-Match': head.headers().etag },
          });
          expect(cached.status()).toBe(304);
        }
        await expect
          .poll(async () => {
            const warm = await request.get(workerOrigin + image.url);
            await warm.body();
            return warm.headers()['x-ajt-media-cache'];
          })
          .toBe('HIT');
        const videoUrl = workerOrigin + video.url;
        const range = await request.get(videoUrl, {
          headers: { Range: 'bytes=0-15' },
        });
        expect(range.status()).toBe(206);
        expect(range.headers()['content-range']).toBe(
          `bytes 0-15/${videoBytes.length}`,
        );
        expect(range.headers()['content-type']).toBe('video/mp4');
        expect(await range.body()).toEqual(videoBytes.subarray(0, 16));
        const suffix = await request.get(videoUrl, {
          headers: { Range: 'bytes=-8' },
        });
        expect(suffix.status()).toBe(206);
        expect(await suffix.body()).toEqual(videoBytes.subarray(-8));
        for (const invalid of ['bytes=999999-', 'bytes=0-1,4-5', 'bytes=-0'])
          expect(
            (
              await request.get(videoUrl, { headers: { Range: invalid } })
            ).status(),
          ).toBe(416);
        expect(
          (
            await request.get(videoUrl, {
              headers: { Range: 'bytes=0-15', 'If-Range': '"outdated"' },
            })
          ).status(),
        ).toBe(200);
        expect((await request.get(workerOrigin + unused.url)).status()).toBe(
          404,
        );
        expect(
          (await request.put(videoUrl, { data: 'overwrite' })).status(),
        ).toBe(405);
        await expect((await request.get(videoUrl)).body()).resolves.toEqual(
          videoBytes,
        );
        expect((await request.get(workerOrigin + '/review/')).status()).toBe(
          404,
        );
        // A cached upload must not let approval succeed after durable storage loses the object.
        const recoverPath = path.join(state, 'recover.jpg');
        await fs.writeFile(
          recoverPath,
          Buffer.concat([
            imageBytes,
            Buffer.from('recoverable storage failure'),
          ]),
        );
        const recover = await tool('upload_media', { path: recoverPath });
        const recoveryMetadata = {
          ...approved.metadata,
          title: 'A recoverable missing media draft',
          image: recover.url,
        };
        delete recoveryMetadata.draft;
        delete recoveryMetadata.example;
        delete recoveryMetadata.video;
        await tool('create_post_draft', {
          slug: 'missing-' + backend + '-object',
          metadata: recoveryMetadata,
          body: 'A draft whose upload must exist in durable storage before approval.',
        });
        const recoverReview = await tool('submit_post_for_review', {
          slug: 'missing-' + backend + '-object',
          expectedRevision: 1,
        });
        if (backend === 'b2')
          await fs.rm(
            path.join(state, 'objects', recover.url.split('/').at(-1)),
          );
        else
          await promisify(execFile)(
            process.execPath,
            [
              'node_modules/wrangler/bin/wrangler.js',
              'r2',
              'object',
              'delete',
              'ajt-website-media/assets/' + recover.url.split('/').at(-1),
              '--local',
              '--persist-to',
              path.join(state, 'r2'),
            ],
            {
              env: {
                ...process.env,
                CI: 'true',
                WRANGLER_SEND_METRICS: 'false',
              },
            },
          );
        await page.goto('/review/' + recoverReview.id);
        await page
          .getByRole('button', { name: 'Publish', exact: true })
          .click();
        await expect(page.getByRole('status')).toContainText(
          backend.toUpperCase() + ' operation failed',
        );
        expect(
          (await tool('get_post', { slug: 'missing-' + backend + '-object' }))
            .metadata.draft,
        ).toBe(true);
        await tool('upload_media', { path: recoverPath });
        await page
          .getByRole('button', { name: 'Retry publishing', exact: true })
          .click();
        await expect(page.getByRole('status')).toContainText(
          'Approved in the local test database',
        );
        expect(
          (await tool('get_post', { slug: 'missing-' + backend + '-object' }))
            .metadata.draft,
        ).toBe(false);
      } finally {
        await client.close();
      }
    });
  });
