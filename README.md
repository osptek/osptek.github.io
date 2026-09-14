# OSPTEK

Customer hub: **https://osptek.github.io/**

This repository is the organization GitHub Pages site.

- `/` — home
- `/displays/` — display module index

Datasheets and examples stay in each product repository. Phase 1 lists **display modules** only.

Do **not** put `catalog.json` in product repos.

## Update the display list

From this directory:

```bash
python3 scripts/build-catalog.py
git add displays/catalog.json
git commit -m "docs(catalog): refresh display module index"
git push github HEAD
```

Do not add a `gitee` remote in phase 1.

Workstation spec: `docs/目录站规范.md`.
