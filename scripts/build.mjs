import * as esbuild from 'esbuild';
import { readdirSync, statSync, existsSync } from 'fs';
import { join, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const srcDir = join(__dirname, '..', 'src');
const outDir = join(__dirname, '..', 'dist');

function findTsFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

if (!existsSync(srcDir)) {
  console.error('Source directory not found:', srcDir);
  process.exit(1);
}

const entryPoints = findTsFiles(srcDir);
console.log(`Found ${entryPoints.length} TypeScript files`);

try {
  await esbuild.build({
    entryPoints,
    outdir: outDir,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    tsconfig: join(__dirname, '..', 'tsconfig.json'),
    logLevel: 'info',
  });
  console.log('Build complete');
} catch (err) {
  console.error('Build failed:', err);
  process.exit(1);
}
