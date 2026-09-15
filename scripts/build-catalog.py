#!/usr/bin/env python3
"""Scan workstation product folders and write products/catalog.json for the Pages site.

Display module names carry their own specs (panel, size, resolution, interface,
driver), so those rows are parsed straight from the folder name. The other
categories only carry a model number, so their card copy comes from the GitHub
repository description, fetched once through `gh`. Without `gh` the script keeps
whatever copy the previous catalog already had, so it still runs offline.
"""

from __future__ import annotations

import collections
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHOP = ROOT.parent / "workstation"
OUT = ROOT / "products" / "catalog.json"
SKIP = {"storage", "storage_finished"}
PANELS = {"amoled", "tft", "lcd", "oled", "epd"}
ORG = "osptek"

# workstation folder -> label shown on the site, in the order the page lists them
CATEGORIES = [
    ("displays", "Displays"),
    ("core-boards", "Core Boards"),
    ("dev-boards", "Dev Boards"),
    ("panels", "Panels"),
    ("cameras", "Cameras"),
    ("sensors", "Sensors"),
]

# trailing words a description repeats from the category tag next to the title
TAIL = re.compile(
    r"\s*(core board|dev board|development board|camera module"
    r"|display module|touch panel|panel|sensor)\s*$",
    re.I,
)


def descriptions() -> dict[str, str]:
    """repo -> description for the org's public repos, or {} when gh is unavailable."""
    try:
        out = subprocess.run(
            [
                "gh", "api", f"orgs/{ORG}/repos?per_page=100", "--paginate",
                "--jq", '.[] | select(.visibility == "public") | [.name, .description // ""] | @tsv',
            ],
            capture_output=True, text=True, timeout=60, check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        print("note: could not reach GitHub, keeping the copy already in the catalog")
        return {}
    rows = (line.split("\t", 1) for line in out.splitlines() if line.strip())
    return {name: (desc[0] if desc else "") for name, *desc in rows}


def previous() -> dict[str, dict]:
    """repo -> row from the last build, used as a fallback for title and summary."""
    try:
        old = json.loads(OUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {row["repo"]: row for row in old.get("items", [])}


def english(text: str) -> bool:
    # the site is English; Chinese descriptions are skipped rather than shown
    return bool(text) and not re.search(r"[\u4e00-\u9fff]", text)


def split_copy(text: str) -> tuple[str, str]:
    """'OSPTEK ESP32-P4C5 core board — 16MB Flash…' -> ('ESP32-P4C5', '16MB Flash…')"""
    body = re.sub(r"^OSPTEK\s+", "", text.strip())
    name, _, rest = body.partition("—")
    if not rest:
        name, _, rest = body.partition(" - ")
    # descriptions continue the sentence after the dash; a card starts a new one
    summary = rest.strip()
    summary = summary[:1].upper() + summary[1:]
    return TAIL.sub("", name.strip()).strip(" .,-"), summary


def readme_copy(path: Path) -> tuple[str, str]:
    """First English heading of a repo, for the few repos with no English description."""
    doc = path / "README_EN.md"
    if not doc.is_file():
        return "", ""
    for line in doc.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith("# "):
            name, summary = split_copy(line[2:])
            # 'documentation & samples' says nothing a visitor cannot already see
            return name, "" if summary.lower().startswith("documentation") else summary
    return "", ""


def display_row(name: str) -> dict | None:
    parts = name.split("-")
    if len(parts) < 5 or parts[0] not in PANELS:
        return None
    return {
        "repo": name,
        "category": "displays",
        "panel": parts[0],
        "size": parts[1],
        "resolution": parts[2],
        "interface": parts[3],
        "interfaces": [x for x in parts[3].split("_") if x],
        "ic": "-".join(parts[4:]),
    }


def camera_row(name: str) -> dict:
    # camera-<interface parts>-<sensor>
    parts = name.split("-")
    return {
        "repo": name,
        "category": "cameras",
        "title": parts[-1].upper(),
        "interface": " ".join(p.upper() for p in parts[1:-1]),
    }


def plain_row(name: str, category: str) -> dict:
    return {"repo": name, "category": category}


def title_from_repo(name: str, category: str) -> str:
    stem = re.sub(r"-(core|dev|module-dev)-board$", "", name)
    return "-".join(p.upper() for p in stem.split("-"))


def rows_in(folder: Path, category: str) -> list[dict]:
    rows = []
    for path in sorted(folder.iterdir()):
        if not path.is_dir() or path.name in SKIP:
            continue
        if category == "displays":
            row = display_row(path.name)
        elif category == "cameras":
            row = camera_row(path.name)
        else:
            row = plain_row(path.name, category)
        if row:
            row["path"] = path
            rows.append(row)
    return rows


def size_key(item: dict) -> tuple:
    try:
        return (float(item["size"]), item["panel"], item["repo"])
    except ValueError:
        return (0.0, item["panel"], item["repo"])


def main() -> None:
    desc = descriptions()
    old = previous()
    live = set(desc)

    items: list[dict] = []
    for key, _label in CATEGORIES:
        folder = SHOP / key
        if not folder.is_dir():
            continue
        rows = rows_in(folder, key)
        for row in rows:
            path = row.pop("path")
            repo = row["repo"]
            # a folder with no public repo yet must not reach the site
            if live and repo not in live:
                print(f"skip {key}/{repo}: no public repository")
                continue

            if key != "displays":
                name, summary = split_copy(desc[repo]) if english(desc.get(repo, "")) else ("", "")
                if not name or not summary:
                    from_readme = readme_copy(path)
                    name = name or from_readme[0]
                    summary = summary or from_readme[1]
                was = old.get(repo, {})
                row["title"] = row.get("title") or name or was.get("title") or title_from_repo(repo, key)
                row["summary"] = summary or was.get("summary", "")

            row["url"] = f"https://github.com/{ORG}/{repo}"
            items.append(row)

    displays = sorted((r for r in items if r["category"] == "displays"), key=size_key)
    others = [r for r in items if r["category"] != "displays"]
    items = displays + others
    counts = collections.Counter(row["category"] for row in items)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_from": "workstation",
        "count": len(items),
        "categories": [
            {"key": key, "label": label, "count": counts.get(key, 0)}
            for key, label in CATEGORIES
            if counts.get(key)
        ],
        "items": items,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} count={len(items)}")
    for key, label in CATEGORIES:
        if counts.get(key):
            print(f"  {label}: {counts[key]}")


if __name__ == "__main__":
    main()
