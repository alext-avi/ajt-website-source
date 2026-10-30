export function mediaType(bytes) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return ['png', 'image/png', 'image'];
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return ['jpg', 'image/jpeg', 'image'];
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()))
    return ['gif', 'image/gif', 'image'];
  if (
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP'
  )
    return ['webp', 'image/webp', 'image'];
  if (
    bytes.length >= 16 &&
    bytes.subarray(4, 8).toString() === 'ftyp' &&
    /^(isom|iso[2-9]|mp41|mp42|avc1|M4V |dash)$/.test(
      bytes.subarray(8, 12).toString('latin1'),
    )
  )
    return ['mp4', 'video/mp4', 'video'];
  if (bytes.subarray(0, 5).toString() === '%PDF-')
    return ['pdf', 'application/pdf', 'document'];
  throw new Error(
    'Upload a PNG, JPEG, GIF, WebP, MP4, or PDF file. SVG and executable files are not accepted.',
  );
}
