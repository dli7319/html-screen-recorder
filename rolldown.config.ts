import { defineConfig } from 'rolldown';

/*
 * App bundle build. `rolldown -c` discovers a config by exact file name in the
 * repo root, and with several candidates it loads only the first extension in
 * its search order (.js, .mjs, .cjs, .ts, ...) - the rest sit there dead,
 * silently ignoring edits. Keep exactly one `rolldown.config.*` file here.
 *
 * The service worker is a second, separate config (rolldown.sw.config.ts) on
 * purpose. The app bundle is an IIFE, which is a single-file format - rolldown
 * will not emit a second entry for it, and quietly drops one rather than
 * failing. Two configs and two invocations is the honest way to get two
 * independent classic scripts out of this toolchain.
 */
export default defineConfig({
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'iife',
  },
});
