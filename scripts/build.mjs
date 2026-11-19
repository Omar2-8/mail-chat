import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');

rmSync(resolve(root, 'out/main'), { recursive: true, force: true });
rmSync(resolve(root, 'out/preload'), { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: dev ? 'inline' : false,
  minify: false,
  logLevel: 'warning'
};

await esbuild({ ...common, entryPoints: [resolve(root, 'src/main/index.ts')], outfile: resolve(root, 'out/main/index.cjs') });
await esbuild({ ...common, entryPoints: [resolve(root, 'src/preload/index.ts')], outfile: resolve(root, 'out/preload/index.cjs') });
await viteBuild({ configFile: resolve(root, 'vite.config.mts'), logLevel: 'warn', build: { minify: !dev, sourcemap: dev } });

console.log(`Built main, preload and renderer into out/ (${dev ? 'dev' : 'production'})`);
