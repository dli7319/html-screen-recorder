import { defineConfig } from 'rolldown';

/*
 * Service worker build, separate from rolldown.config.ts on purpose.
 *
 * The app bundle is an IIFE, which is a single-file format - rolldown will not
 * emit a second entry for it, and quietly drops one rather than failing. Two
 * configs and two invocations is the honest way to get two independent classic
 * scripts out of this toolchain.
 *
 * dist/sw.js is a build artefact (gitignored via dist/*.js). It still carries
 * the __PRECACHE_MANIFEST__ / __CACHE_VERSION__ placeholders when this finishes;
 * scripts/build-sw.ts substitutes real values afterwards, once the rest of
 * dist/ exists and can be hashed.
 */
export default defineConfig({
  input: 'src/sw.ts',
  output: {
    file: 'dist/sw.js',
    format: 'iife',
    // Silences rolldown's unnamed-IIFE warning. Nothing reads these exports in
    // the browser - the unit tests import the source file directly - so the
    // name only exists to keep the build output quiet.
    name: 'ScreenRecorderServiceWorker',
  },
});
