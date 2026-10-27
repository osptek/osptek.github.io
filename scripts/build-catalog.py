#!/usr/bin/env python3
"""Build products/catalog.json from the display repositories on GitHub.

Every public `display-*` repository keeps one osptek.yml per model, at
versions/<model>/osptek.yml. Each of those files becomes one catalog row.
"""

from __future__ import annotations

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
OUT = ROOT / "products" / "catalog.json"
ORG = "osptek"
PREFIX = "display-"
META = re.compile(r"^versions/([^/]+)/osptek\.yml$")


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


def fetch(url: str, token: str, accept: str) -> bytes:
    headers = {
        "Accept": accept,
        "User-Agent": "osptek-catalog-builder",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def github_json(path: str, token: str):
    """Read one GitHub REST endpoint and decode its JSON response."""
    url = f"https://api.github.com/{path.lstrip('/')}"
    return json.loads(fetch(url, token, "application/vnd.github+json"))


def display_repositories(token: str) -> list[dict]:
    """All public display repositories in the organization."""
    repos: list[dict] = []
    page = 1
    while True:
        query = urllib.parse.urlencode(
            {"type": "public", "per_page": 100, "page": page, "sort": "full_name"}
        )
        data = github_json(f"orgs/{ORG}/repos?{query}", token)
        if not isinstance(data, list):
            raise RuntimeError("GitHub repository response was not a list")
        repos.extend(
            repo for repo in data
            if repo.get("visibility") == "public" and repo["name"].startswith(PREFIX)
        )
        if len(data) < 100:
            return repos
        page += 1


def model_files(repo: dict, token: str) -> list[str]:
    """Paths of versions/<model>/osptek.yml in one repository."""
    name = urllib.parse.quote(repo["name"], safe="")
    branch = urllib.parse.quote(repo["default_branch"], safe="")
    tree = github_json(f"repos/{ORG}/{name}/git/trees/{branch}?recursive=1", token)
    if tree.get("truncated"):
        print(f"warn: {repo['name']}: file tree truncated, some models may be missing")
    return sorted(
        node["path"] for node in tree.get("tree", [])
        if node.get("type") == "blob" and META.match(node["path"])
    )


def read_meta(repo: dict, path: str, token: str) -> dict | None:
    """Fetch and parse one model's osptek.yml."""
    name = urllib.parse.quote(repo["name"], safe="")
    url = (
        f"https://api.github.com/repos/{ORG}/{name}/contents/"
        f"{urllib.parse.quote(path)}?ref={urllib.parse.quote(repo['default_branch'])}"
    )
    try:
        meta = yaml.safe_load(fetch(url, token, "application/vnd.github.raw").decode("utf-8"))
    except (UnicodeError, yaml.YAMLError) as err:
        print(f"warn: {repo['name']}/{path} is unreadable: {err}")
        return None
    return meta if isinstance(meta, dict) else None


def as_list(value) -> list[str]:
    """A scalar or list from YAML, always returned as a list without blanks."""
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    return [str(x).strip() for x in items if x not in (None, "", "none")]


def text(value) -> str:
    return "" if value is None else str(value).strip()


def model_row(repo: dict, path: str, meta: dict) -> dict | None:
    """One catalog row from versions/<model>/osptek.yml."""
    folder = META.match(path).group(1)
    model = text(meta.get("id")) or folder
    where = f"{repo['name']}/{path}"
    if model != folder:
        print(f"warn: {where}: id {model!r} differs from its folder")
    if meta.get("category") not in (None, "displays"):
        print(f"warn: skip {where}: category is {meta.get('category')!r}")
        return None
    missing = [key for key in ("panel", "size", "resolution") if not text(meta.get(key))]
    if missing:
        print(f"warn: skip {where}: missing {', '.join(missing)}")
        return None

    active = text(meta.get("active_area"))
    branch = urllib.parse.quote(repo["default_branch"])
    return {
        "id": model,
        "repo": repo["name"],
        "panel": text(meta["panel"]).lower(),
        "size": text(meta["size"]),
        "resolution": text(meta["resolution"]).lower(),
        "interfaces": [x.lower() for x in as_list(meta.get("interface"))],
        "driver": text(meta.get("driver")),
        "touch": text(meta.get("touch")),
        "outline": text(meta.get("outline")),
        "active_area": active,
        # a round screen gives its active area as a diameter
        "shape": "round" if active.startswith("Φ") else "rect",
        "url": f"{repo['html_url']}/tree/{branch}/{urllib.parse.quote(path.rsplit('/', 1)[0])}",
    }


def size_key(row: dict) -> tuple:
    try:
        size = float(row["size"])
    except ValueError:
        size = 0.0
    return (size, row["panel"], row["repo"], row["id"])


def build() -> list[dict]:
    token = github_token()
    if not token:
        print("note: no GitHub token; unauthenticated API limits may apply")
    repos = display_repositories(token)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        paths = list(pool.map(lambda repo: model_files(repo, token), repos))
        jobs = [(repo, path) for repo, found in zip(repos, paths) for path in found]
        metas = list(pool.map(lambda job: read_meta(*job, token), jobs))

    for repo, found in zip(repos, paths):
        if not found:
            print(f"warn: {repo['name']}: no versions/*/osptek.yml")

    rows = []
    for (repo, path), meta in zip(jobs, metas):
        row = model_row(repo, path, meta) if meta else None
        if row:
            rows.append(row)
    print(f"read repositories={len(repos)} models={len(jobs)} rows={len(rows)}")
    return sorted(rows, key=size_key)


def main() -> None:
    items = build()
    payload = {
        "generated_from": "github:versions/*/osptek.yml",
        "count": len(items),
        "repos": len({row["repo"] for row in items}),
        "items": items,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} count={payload['count']} repos={payload['repos']}")


if __name__ == "__main__":
    main()
