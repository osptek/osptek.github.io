# OSPTEK

Customer hub: **https://osptek.github.io/**

This repository is the organization GitHub Pages site.

- `/` — home, with a card per product category
- `/products/` — product finder (all categories, `?cat=displays` and friends)
- `/displays/` — old display-only address, redirects into `/products/`

Datasheets and examples stay in each product repository.

Do **not** put `catalog.json` in product repos.

## Refresh the product list

From this directory:

```bash
python3 scripts/build-catalog.py
git add products/catalog.json
git commit -m "docs(catalog): refresh product index"
git push github HEAD
```

The script reads the workstation category folders. Display rows come from the
folder name; every other category takes its card copy from the GitHub repository
description, so keep `gh` signed in — without it the script reuses the copy
already in `products/catalog.json`. Private repositories are skipped.

Do not add a `gitee` remote in phase 1.

Workstation spec: `docs/目录站规范.md`.
