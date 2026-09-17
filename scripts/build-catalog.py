#!/usr/bin/env python3
"""Build products/catalog.json from product repositories' osptek.yml files.

The default local mode scans sibling workstation folders. GitHub mode discovers
public organization repositories and reads osptek.yml through the GitHub API,
so it can run in Actions without a workstation checkout.
"""

from __future__ import annotations

import argparse
import base64
import collections
import concurrent.futures
import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

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
CATEGORY_KEYS = {key for key, _label in CATEGORIES}


def github_token() -> str:
    """Use the Actions token, or the local gh login when available."""
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        return token
    try:
        return subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def github_json(path: str, token: str):
    """Read one GitHub REST endpoint and decode its JSON response."""
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "osptek-catalog-builder",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        f"https://api.github.com/{path.lstrip('/')}",
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def github_repositories(token: str) -> list[dict]:
    """All public repositories in the organization."""
    repos: list[dict] = []
    page = 1
    while True:
        query = urllib.parse.urlencode(
            {"type": "public", "per_page": 100, "page": page, "sort": "full_name"}
        )
        data = github_json(f"orgs/{ORG}/repos?{query}", token)
        if not isinstance(data, list):
            raise RuntimeError("GitHub repository response was not a list")
        repos.extend(repo for repo in data if repo.get("visibility") == "public")
        if len(data) < 100:
            return repos
        page += 1


def github_meta(name: str, token: str) -> dict | None:
    """Fetch and parse one repository's root osptek.yml."""
    quoted = urllib.parse.quote(name, safe="")
    try:
        data = github_json(f"repos/{ORG}/{quoted}/contents/osptek.yml", token)
    except urllib.error.HTTPError as err:
        if err.code != 404:
            print(f"warn: {name}/osptek.yml: GitHub returned HTTP {err.code}")
        return None
    try:
        raw = base64.b64decode(data["content"]).decode("utf-8")
        meta = yaml.safe_load(raw)
    except (KeyError, ValueError, UnicodeError, yaml.YAMLError) as err:
        print(f"warn: {name}/osptek.yml is unreadable: {err}")
        return None
    return meta if isinstance(meta, dict) else None

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


def as_list(value) -> list:
    """A scalar or list from YAML, always returned as a list without blanks/none."""
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    return [x for x in items if x not in (None, "", "none")]


def load_meta(path: Path) -> dict | None:
    """The repo's osptek.yml as a dict, or None when it is absent or unreadable."""
    doc = path / "osptek.yml"
    if not doc.is_file():
        return None
    try:
        data = yaml.safe_load(doc.read_text(encoding="utf-8"))
    except yaml.YAMLError as err:
        print(f"warn: skipping unreadable {doc.relative_to(SHOP)}: {err}")
        return None
    return data if isinstance(data, dict) else None


def drivers_of(meta: dict) -> list[str]:
    """Distinct display driver ICs across every version, in first-seen order."""
    seen: list[str] = []
    for version in meta.get("versions") or []:
        for ic in as_list(version.get("driver")):
            if ic not in seen:
                seen.append(ic)
    return seen


def row_from_meta(meta: dict, folder_category: str, name: str) -> dict:
    """Build a catalog row from osptek.yml; the file, not the folder name, wins."""
    repo = str(meta.get("id") or name)
    category = meta.get("category") or folder_category
    row = {"repo": repo, "category": category}

    if category == "displays":
        base = display_row(repo) or {}
        ifaces = as_list(meta.get("interface")) or base.get("interfaces", [])
        ics = drivers_of(meta) or ([base["ic"]] if base.get("ic") else [])
        row.update(
            {
                "panel": meta.get("panel") or base.get("panel"),
                "size": str(meta.get("size") or base.get("size") or ""),
                "resolution": meta.get("resolution") or base.get("resolution"),
                "interface": "_".join(ifaces),
                "interfaces": ifaces,
                "shape": meta.get("shape"),
                # match the folder-derived corpus (lowercase); the page upcases it
                "ic": " / ".join(ics).lower(),
            }
        )
        if meta.get("corner") in {"sharp", "rounded"}:
            row["corner"] = meta["corner"]
    else:
        row["title"] = meta.get("title") or title_from_repo(repo, category)
        ifaces = as_list(meta.get("interface"))
        if ifaces:
            row["interface"] = " ".join(ifaces).upper()
        row["summary"] = meta.get("summary", "")
        specs = meta.get("specs")
        if isinstance(specs, dict) and specs:
            row["specs"] = specs
    return row


def rows_in(folder: Path, category: str) -> list[dict]:
    rows = []
    for path in sorted(folder.iterdir()):
        if not path.is_dir() or path.name in SKIP:
            continue
        meta = load_meta(path)
        if meta:
            row = row_from_meta(meta, category, path.name)
            row["from_meta"] = True
        elif category == "displays":
            row = display_row(path.name)
        elif category == "cameras":
            row = camera_row(path.name)
        else:
            row = plain_row(path.name, category)
        if row:
            row["path"] = path
            rows.append(row)
    return rows


def rows_from_github(old: dict[str, dict]) -> list[dict]:
    """Build rows directly from public repositories' root osptek.yml files."""
    token = github_token()
    if not token:
        print("note: no GitHub token; unauthenticated API limits may apply")
    repos = github_repositories(token)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        metas = list(pool.map(lambda repo: github_meta(repo["name"], token), repos))

    rows: list[dict] = []
    migrated = 0
    preserved = 0
    for repo, meta in zip(repos, metas):
        name = repo["name"]
        if meta:
            meta_id = str(meta.get("id") or name)
            category = meta.get("category")
            if meta_id != name:
                print(f"warn: skip {name}: osptek.yml id is {meta_id!r}")
                continue
            if category not in CATEGORY_KEYS:
                print(f"warn: skip {name}: unknown category {category!r}")
                continue
            row = row_from_meta(meta, category, name)
            migrated += 1
        else:
            # During migration, retain an existing public row until its
            # repository gains osptek.yml. New repositories require metadata.
            was = old.get(name)
            if not was or was.get("category") not in CATEGORY_KEYS:
                continue
            row = {
                key: value
                for key, value in was.items()
                if key not in {"url"}
            }
            preserved += 1

        row["url"] = repo.get("html_url") or f"https://github.com/{ORG}/{name}"
        rows.append(row)

    print(
        f"read GitHub repositories={len(repos)} "
        f"osptek.yml={migrated} preserved={preserved}"
    )
    return rows


def size_key(item: dict) -> tuple:
    try:
        return (float(item["size"]), item["panel"], item["repo"])
    except ValueError:
        return (0.0, item["panel"], item["repo"])


def rows_from_workstation() -> list[dict]:
    """Build rows from the local workstation checkout."""
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
            from_meta = row.pop("from_meta", False)
            repo = row["repo"]
            # a folder with no public repo yet must not reach the site
            if live and repo not in live:
                print(f"skip {key}/{repo}: no public repository")
                continue

            # osptek.yml already carries the card copy; only derive it otherwise
            if key != "displays" and not from_meta:
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
    return items


def write_catalog(items: list[dict], generated_from: str) -> None:
    """Sort, summarize and write the public catalog."""
    displays = sorted((r for r in items if r["category"] == "displays"), key=size_key)
    others = [r for r in items if r["category"] != "displays"]
    items = displays + others
    counts = collections.Counter(row["category"] for row in items)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_from": generated_from,
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        choices=("auto", "workstation", "github"),
        default=os.environ.get("CATALOG_SOURCE", "auto"),
        help="metadata source (default: workstation when present, otherwise GitHub)",
    )
    args = parser.parse_args()
    source = args.source
    if source == "auto":
        source = "workstation" if SHOP.is_dir() else "github"

    if source == "github":
        items = rows_from_github(previous())
        write_catalog(items, "github:osptek.yml")
    else:
        if not SHOP.is_dir():
            parser.error(f"workstation directory does not exist: {SHOP}")
        write_catalog(rows_from_workstation(), "workstation")


if __name__ == "__main__":
    main()
