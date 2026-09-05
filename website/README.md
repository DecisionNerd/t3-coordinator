# Docs site (Starlight)

Astro Starlight site for **t3-coordinator**, deployed to GitHub Pages at  
https://decisionnerd.github.io/t3-coordinator/

```bash
# from repo root
npm run docs:dev
npm run docs:build
```

Or from this directory: `npm run dev` / `npm run build`.

Content lives in `src/content/docs/`. Config: `astro.config.mjs` (`site` + `base` for Pages). Deploy workflow: `../.github/workflows/docs.yml`.

After the first deploy, set the repo **Settings → Pages → Source** to **GitHub Actions**.
