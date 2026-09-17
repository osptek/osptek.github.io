# OSPTEK

Customer hub: **https://osptek.github.io/**

This repository is the organization GitHub Pages site.

- `/` — home, with a card per product category
- `/products/` — product finder (all categories, `?cat=displays` and friends)
- `/displays/` — old display-only address, redirects into `/products/`

Datasheets and examples stay in each product repository.

Do **not** put `catalog.json` in product repos.

## Product catalog sync

`.github/workflows/sync-catalog.yml` refreshes the catalog every six hours. It
discovers public `osptek` repositories, reads each root `osptek.yml`, rebuilds
`products/catalog.json`, and commits only when the generated file changed.
The workflow can also be run manually, or triggered with a `catalog-sync`
repository dispatch event.

For a local preview from the workstation:

```bash
python3 scripts/build-catalog.py
```

To test the same source used by Actions:

```bash
python3 scripts/build-catalog.py --source github
```

GitHub mode requires `GITHUB_TOKEN` or a signed-in `gh` CLI. Repositories that
do not yet contain `osptek.yml` retain their existing catalog row during the
migration; new products appear after their metadata file is pushed.

Do not add a `gitee` remote in phase 1.

Workstation spec: `docs/目录站规范.md`.
