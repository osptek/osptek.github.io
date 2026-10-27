# OSPTEK

Customer hub: **https://osptek.github.io/**

This repository is the organization GitHub Pages site.

- `/` — home
- `/products/` — display finder, one card per model
- `/displays/` — old address, redirects into `/products/`

Only displays are listed for now; the other product lines are left out until
their metadata moves to the same per-model format.

Datasheets and examples stay in each product repository.

Do **not** put `catalog.json` in product repos.

## Product catalog sync

`.github/workflows/sync-catalog.yml` refreshes the catalog every six hours. It
lists the public `display-*` repositories in `osptek`, reads every
`versions/<model>/osptek.yml`, rebuilds `products/catalog.json` with one row
per model, and commits only when the generated file changed. The workflow can
also be run manually, or triggered with a `catalog-sync` repository dispatch
event.

A model's osptek.yml looks like this:

```yaml
id: YDP200B001-V9          # must match the folder name under versions/
category: displays
size: "2"
panel: tft                 # tft, amoled, rlcd, epd, oled
resolution: 480x360
interface: [mipi]
driver: ST7701S
touch: null                # touch IC, e.g. CST820
outline: 45.8 x 40.2 mm
active_area: 40.82 x 30.62 mm   # "Φ32.4 mm" marks a round screen
```

To rebuild locally:

```bash
python3 scripts/build-catalog.py
```

This needs PyYAML and `GITHUB_TOKEN` or a signed-in `gh` CLI.

Do not add a `gitee` remote in phase 1.

Workstation spec: `docs/目录站规范.md`.
