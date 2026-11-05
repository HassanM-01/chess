import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// The desktop UI is its own Vite project (src/desktop) so none of the web app's backend code or keys end up in it.
export default defineConfig({
  root: fileURLToPath(new URL('./src/desktop', import.meta.url)),
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  envDir: fileURLToPath(new URL('./src/desktop', import.meta.url)), // never read the repo's .env.local
  server: { port: 5199, strictPort: true },
  build: { outDir: fileURLToPath(new URL('./dist-desktop', import.meta.url)), emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
});
