// The same immutable names are used by authoring, the build, and the public Worker.
export const mediaFilename = /^[a-f0-9]{64}\.(png|jpg|gif|webp|mp4|pdf)$/;
export const mediaPath =
  /^\/media\/([a-f0-9]{64}\.(?:png|jpg|gif|webp|mp4|pdf))$/;
export const mediaManifestPath = '/media-manifest.json';
export const mediaTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
};
