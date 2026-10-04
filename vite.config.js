import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: { target: 'es2020' },
  define: { __APP_VERSION__: JSON.stringify(`${process.env.npm_package_version || '1.0.0'} (${new Date().toISOString().slice(0, 10)})`) },
  plugins: [
    VitePWA({
      // The app tells you when a new version is ready and reloads when you tap it.
      // A new version also takes over by itself the next time you open the app
      // after fully closing it, so a deploy never gets stuck behind a stale cache.
      registerType: 'prompt',
      injectRegister: null,
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Life Command Center',
        short_name: 'Command',
        description: 'Your daily plan, call list, check-ins and training log.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F2F4F7',
        theme_color: '#F2F4F7',
        lang: 'en',
        categories: ['productivity'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Today', url: '/#today', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Calls', url: '/#calls', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Log a session', url: '/#log', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
        ],
      },
      // src/sw.js is our own worker (precache + push reminders); the plugin injects the
      // list of built files into it. Supabase requests are never cached: the data
      // layer keeps its own local copy.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
        globIgnores: ['**/icon-512*.png'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
});
