import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = root;
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of [
  'index.html',
  'styles.css',
  'reveal-fix.css',
  'responsive.css',
  'script.js',
  'Dhia_Lebenslauf.pdf',
  'robots.txt',
  'sitemap.xml',
  'site.webmanifest',
  'favicon.svg',
  '404.html'
]) {
  await cp(resolve(source, file), resolve(output, file));
}

console.log('Portfolio built successfully in dist/');
