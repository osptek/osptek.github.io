# OSPTEK Product Catalog

Customer index: **https://osptek.github.io/**

This repository is the organization GitHub Pages site. It lists product repos; datasheets and examples stay in each product repository.

Phase 1 lists **display modules** only.

## Update the display list

From this directory:

```bash
python3 scripts/build-catalog.py
git add catalog/displays.json
git commit -m "docs(catalog): refresh display module index"
git push github HEAD
```

Do not add a `gitee` remote in phase 1.

Workstation spec: `docs/目录站规范.md`.
