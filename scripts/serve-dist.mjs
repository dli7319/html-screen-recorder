/**
 * Serve the built `dist/` for the Playwright integration tests.
 *
 * A dependency-free static server so the e2e run needs nothing beyond Node.
 * It is only ever pointed at the already-built `dist/` (the CI job runs
 * `npm run build` first).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 4317);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let pathname = normalize(
      decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    );
    if (pathname.endsWith(sep) || pathname === '.') pathname += 'index.html';
    const file = join(root, pathname);
    // Keep requests inside dist/ (a static server should never escape its root).
    if (!file.startsWith(root + sep) && file !== join(root, 'index.html')) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving dist/ on http://127.0.0.1:${port}`);
});
