const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const maxAssetBytes = 500 * 1024;
const jsSkip = new Set([path.join(root, 'frontend', 'extension', 'transformers.min.js')]);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function checkJs(file) {
  const source = fs.readFileSync(file, 'utf8');
  const isFrontend = file.startsWith(path.join(root, 'frontend'));
  const isModule =
    isFrontend && /^\s*(import|export)\s/m.test(source);
  const args = isModule ? ['--check', '--input-type=module'] : ['--check', file];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    input: isModule ? source : undefined
  });
  if (result.status !== 0) {
    return (result.stderr || result.stdout || '').trim();
  }
  return null;
}

function checkDuplicateIds(file) {
  const html = fs.readFileSync(file, 'utf8');
  const ids = new Map();
  const re = /\bid\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    ids.set(match[1], (ids.get(match[1]) || 0) + 1);
  }
  return Array.from(ids.entries())
    .filter(([, count]) => count > 1)
    .map(([id, count]) => `${id} (${count})`);
}

function main() {
  const jsFiles = walk(path.join(root, 'frontend'))
    .concat(walk(path.join(root, 'backend', 'functions')))
    .filter((file) => file.endsWith('.js') && !jsSkip.has(file));
  const htmlFiles = walk(path.join(root, 'frontend')).filter((file) => file.endsWith('.html'));
  const assetFiles = walk(path.join(root, 'frontend', 'assets'));

  let failed = false;

  console.log(`Checking ${jsFiles.length} JavaScript files...`);
  for (const file of jsFiles) {
    const err = checkJs(file);
    if (err) {
      failed = true;
      console.error(`\nJS syntax error in ${rel(file)}:\n${err}`);
    }
  }

  console.log(`Checking ${htmlFiles.length} HTML files for duplicate IDs...`);
  for (const file of htmlFiles) {
    const duplicates = checkDuplicateIds(file);
    if (duplicates.length) {
      failed = true;
      console.error(`\nDuplicate IDs in ${rel(file)}: ${duplicates.join(', ')}`);
    }
  }

  console.log(`Checking frontend/assets for files over ${Math.round(maxAssetBytes / 1024)} KB...`);
  const largeAssets = assetFiles
    .map((file) => ({ file, size: fs.statSync(file).size }))
    .filter((item) => item.size > maxAssetBytes)
    .sort((a, b) => b.size - a.size);
  if (largeAssets.length) {
    console.warn('\nLarge assets:');
    for (const item of largeAssets) {
      console.warn(`- ${rel(item.file)} ${Math.round(item.size / 1024)} KB`);
    }
  }

  if (failed) process.exit(1);
  console.log('All checks passed.');
}

main();
