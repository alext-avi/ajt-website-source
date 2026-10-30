import fs from 'node:fs/promises';
import { parse } from 'jsonc-parser';
export async function readJsonc(file) {
  const errors = [];
  const value = parse(await fs.readFile(file, 'utf8'), errors, {
    allowTrailingComma: true,
  });
  if (
    errors.length ||
    !value ||
    Array.isArray(value) ||
    typeof value !== 'object'
  )
    throw new Error('Invalid configuration: ' + file);
  return value;
}
