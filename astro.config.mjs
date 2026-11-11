import { defineConfig } from 'astro/config';

// BASE_PATH is set by the GitHub Pages workflow ("/notes-and-asides" until the
// custom domain is connected, then "/"). SITE_URL likewise.
export default defineConfig({
  site: process.env.SITE_URL || 'https://notesasides.com',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  output: 'static',
});
