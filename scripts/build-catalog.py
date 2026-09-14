#!/usr/bin/env python3
"""Scan workstation/displays and write displays/catalog.json for the Pages site."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DISPLAYS = ROOT.parent / "workstation" / "displays"
OUT = ROOT / "displays" / "catalog.json"
SKIP = {"storage", "storage_finished"}
PANELS = {"amoled", "tft", "lcd", "oled", "epd"}


def parse(name: str) -> dict | None:
    parts = name.split("-")
    if len(parts) < 5 or parts[0] not in PANELS:
        return None
    return {
        "repo": name,
        "panel": parts[0],
        "size": parts[1],
        "resolution": parts[2],
        "interface": parts[3],
        "ic": "-".join(parts[4:]),
        "url": f"https://github.com/osptek/{name}",
    }


def size_key(item: dict) -> tuple:
    try:
        return (float(item["size"]), item["panel"], item["repo"])
    except ValueError:
        return (0.0, item["panel"], item["repo"])


def main() -> None:
    items = []
    for path in DISPLAYS.iterdir():
        if not path.is_dir() or path.name in SKIP:
            continue
        row = parse(path.name)
        if row:
            items.append(row)
    items.sort(key=size_key)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_from": "workstation/displays",
        "count": len(items),
        "items": items,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} count={len(items)}")


if __name__ == "__main__":
    main()
