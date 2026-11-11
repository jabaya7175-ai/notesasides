# Notes & Asides

Joshua A. Abaya's writing site: *a blog of conservative thought and Reformed musings.*

- **Site**: static [Astro](https://astro.build) pages, hosted on GitHub Pages, rebuilt on every push and hourly.
- **Studio** (`/studio/`): private editor (sign-in by emailed link). Drafts, notes, books and images live in Supabase.
- **Database**: Supabase project `cxsyqbvcqkuiidmcqrxo`. Row-level security lets the public read published posts only; only accounts in the `admins` table can write.

## Develop

```sh
npm install
npm run dev     # http://localhost:4321
npm run build   # → dist/
```

## How publishing works

1. Write in the Studio; it autosaves to Supabase.
2. **Publish** marks the post published. The home page lists it at once (it reads the database in the browser), and `/p/<slug>/` works right away through a fallback reader.
3. The hourly build (or any push) bakes it into a permanent static page.

## Layout

```
src/lib/render.js      shared article renderer (site, fallback reader, Studio preview)
src/scripts/reader.js  drop cap geometry, side notes, book rail
src/styles/site.css    site typesetting (EB Garamond, dark navy)
src/studio/            Studio editor (main.js, studio.css)
src/pages/             home, archive, about, p/[slug], read (fallback), studio
```
