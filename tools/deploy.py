"""Publish the static site to GitHub Pages through the GitHub REST API.

The repository has no local Git dependency; files are uploaded as Git blobs
and committed with the Git Data API. The token is read from `gh auth token`
and never printed.
"""
from __future__ import annotations

import base64
import subprocess
import sys
import time
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")

OWNER = "Liu68411"
REPO = "mathactivity-gaotie"
BRANCH = "main"
ROOT = Path(__file__).resolve().parent.parent
FILES = [
    "index.html",
    "README.md",
    ".nojekyll",
    ".gitignore",
    "assets/style.css",
    "assets/app.js",
    "assets/model.js",
    "assets/hero.jpg",
    "assets/favicon.svg",
    "tools/model.test.mjs",
    "tools/test-ui.py",
    "tools/capture.py",
    "tools/deploy.py",
]
API = "https://api.github.com"


def token() -> str:
    value = subprocess.check_output(["gh", "auth", "token"], text=True).strip()
    if not value:
        raise SystemExit("gh auth token returned an empty token")
    return value


def main() -> None:
    session = requests.Session()
    session.headers.update(
        {
            "Authorization": f"Bearer {token()}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "mathactivity-gaotie-deploy",
        }
    )

    repo_url = f"{API}/repos/{OWNER}/{REPO}"
    response = session.get(repo_url, timeout=20)
    if response.status_code == 404:
        print(f"Creating {OWNER}/{REPO} ...")
        created = session.post(
            f"{API}/user/repos",
            json={
                "name": REPO,
                "description": "G80 雾雪限速后几点能到站 · 专题三交互估算页",
                "homepage": f"https://{OWNER.lower()}.github.io/{REPO}/",
                "private": False,
                "has_issues": True,
                "has_projects": False,
                "has_wiki": False,
                "auto_init": False,
            },
            timeout=30,
        )
        if created.status_code not in (200, 201):
            raise SystemExit(f"create repo failed: {created.status_code} {created.text}")
        repo_url = created.json()["url"]
    elif response.status_code == 200:
        print(f"Repository exists: {repo_url}")
    else:
        raise SystemExit(f"get repo failed: {response.status_code} {response.text}")

    # Find the current head, if any, so the new commit keeps history.
    parent = None
    ref = session.get(f"{repo_url}/git/ref/heads/{BRANCH}", timeout=20)
    if ref.status_code == 409:
        print("Empty repository; creating a bootstrap commit through the Contents API ...")
        bootstrap = session.put(
            f"{repo_url}/contents/README.md",
            json={
                "message": "Initialize repository",
                "content": base64.b64encode(b"# mathactivity-gaotie\n").decode("ascii"),
                "branch": BRANCH,
            },
            timeout=30,
        )
        if bootstrap.status_code not in (200, 201):
            raise SystemExit(f"bootstrap failed: {bootstrap.status_code} {bootstrap.text}")
        ref = session.get(f"{repo_url}/git/ref/heads/{BRANCH}", timeout=20)

    if ref.status_code == 200:
        parent = ref.json()["object"]["sha"]
        print(f"Parent commit: {parent[:12]}")
    elif ref.status_code != 404:
        raise SystemExit(f"get ref failed: {ref.status_code} {ref.text}")

    tree = []
    for relative in FILES:
        path = ROOT / relative
        if not path.is_file():
            raise SystemExit(f"missing file: {relative}")
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        blob = session.post(
            f"{repo_url}/git/blobs",
            json={"content": data, "encoding": "base64"},
            timeout=60,
        )
        if blob.status_code not in (200, 201):
            raise SystemExit(f"create blob {relative} failed: {blob.status_code} {blob.text}")
        tree.append(
            {
                "path": relative,
                "mode": "100644",
                "type": "blob",
                "sha": blob.json()["sha"],
            }
        )
        print(f"  uploaded {relative} ({path.stat().st_size:,} bytes)")

    tree_response = session.post(f"{repo_url}/git/trees", json={"tree": tree}, timeout=30)
    if tree_response.status_code not in (200, 201):
        raise SystemExit(f"create tree failed: {tree_response.status_code} {tree_response.text}")
    tree_sha = tree_response.json()["sha"]

    message = "Build G80 snow-limit arrival activity"
    commit_body = {"message": message, "tree": tree_sha}
    if parent:
        commit_body["parents"] = [parent]
    commit = session.post(f"{repo_url}/git/commits", json=commit_body, timeout=30)
    if commit.status_code not in (200, 201):
        raise SystemExit(f"create commit failed: {commit.status_code} {commit.text}")
    commit_sha = commit.json()["sha"]
    print(f"Commit: {commit_sha}")

    if parent:
        updated = session.patch(
            f"{repo_url}/git/refs/heads/{BRANCH}",
            json={"sha": commit_sha, "force": False},
            timeout=20,
        )
    else:
        updated = session.post(
            f"{repo_url}/git/refs",
            json={"ref": f"refs/heads/{BRANCH}", "sha": commit_sha},
            timeout=20,
        )
    if updated.status_code not in (200, 201):
        raise SystemExit(f"update ref failed: {updated.status_code} {updated.text}")
    print(f"Branch {BRANCH} -> {commit_sha[:12]}")

    pages_url = f"{repo_url}/pages"
    pages = session.get(pages_url, timeout=20)
    source = {"branch": BRANCH, "path": "/"}
    if pages.status_code == 404:
        pages = session.post(pages_url, json={"source": source}, timeout=30)
    elif pages.status_code == 200:
        current = pages.json().get("source", {})
        if current.get("branch") != BRANCH or current.get("path") != "/":
            pages = session.put(pages_url, json={"source": source}, timeout=30)
        else:
            print("Pages already configured.")
    if pages.status_code not in (200, 201, 204):
        raise SystemExit(f"configure Pages failed: {pages.status_code} {pages.text}")

    print("Waiting for the Pages build ...")
    final = None
    for _ in range(30):
        time.sleep(6)
        status = session.get(pages_url, timeout=20)
        if status.status_code != 200:
            continue
        payload = status.json()
        final = payload
        print(f"  status={payload.get('status')} url={payload.get('html_url')}")
        if payload.get("status") in ("built", "errored"):
            break

    if final:
        print(f"Pages URL: {final.get('html_url')}")
        print(f"Source: {final.get('source')}")
    else:
        print("Pages build status could not be read yet; check the repository settings.")
    print(f"Repository: https://github.com/{OWNER}/{REPO}")


if __name__ == "__main__":
    main()
