import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Lists every file under dir, relative to root, with forward slashes. */
function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? listFiles(full, root)
      : [relative(root, full).split('\\').join('/')];
  });
}

/**
 * Fills the precache list and a version hash into dist/sw.js after the build,
 * so the app works offline without pulling in a service worker toolkit.
 */
function serviceWorkerPrecache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'service-worker-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      // html2canvas and purify are optional jsPDF extras that this app never loads.
      const files = listFiles(outDir).filter((f) => f !== 'sw.js' && !/html2canvas|purify/.test(f));
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const assets = ['./', ...files.map((f) => `./${f}`)];
      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('self.__ASSETS__', JSON.stringify(assets));
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  // Relative base so the same build works on Netlify (root) and GitHub Pages (subfolder).
  base: './',
  plugins: [react(), tailwindcss(), serviceWorkerPrecache()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
