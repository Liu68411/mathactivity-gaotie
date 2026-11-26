"""Publish the static site to GitHub Pages through the GitHub CLI.

The repository has no local Git dependency; files are uploaded as Git blobs
and committed with the Git Data API. Authentication is handled by `gh`, so
the token is never read or printed by this script.
"""
from __future__ import annotations

import base64
import json
import subprocess
import sys
import time
from pathlib import Path

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


class GhError(RuntimeError):
    def __init__(self, endpoint: str, message: str):
        super().__init__(message)
        self.endpoint = endpoint
        self.message = message


def gh(method: str, endpoint: str, payload: dict | None = None) -> dict | None:
    command = ["gh", "api", "--method", method, endpoint]
    if payload is not None:
        command.extend(["--input", "-"])
    result = subprocess.run(
        command,
        input=json.dumps(payload) if payload is not None else None,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    if result.returncode != 0:
        raise GhError(endpoint, (result.stderr or result.stdout).strip())
    text = result.stdout.strip()
    return json.loads(text) if text else None


def main() -> None:
    repo_endpoint = f"repos/{OWNER}/{REPO}"
    try:
        gh("GET", repo_endpoint)
        print(f"Repository exists: {repo_endpoint}")
    except GhError as error:
        if "Not Found" not in error.message:
            raise
        print(f"Creating {OWNER}/{REPO} ...")
        gh(
            "POST",
            "user/repos",
            {
                "name": REPO,
                "description": "G80 雾雪限速后几点能到站 · 专题三交互估算页",
                "homepage": f"https://{OWNER.lower()}.github.io/{REPO}/",
                "private": False,
                "has_issues": True,
                "has_projects": False,
                "has_wiki": False,
                "auto_init": False,
            },
        )

    parent = None
    try:
        ref = gh("GET", f"{repo_endpoint}/git/ref/heads/{BRANCH}")
        parent = ref["object"]["sha"]
        print(f"Parent commit: {parent[:12]}")
    except GhError as error:
        if "Not Found" not in error.message and "empty" not in error.message.lower():
            raise
        print("Empty repository; creating a bootstrap commit through the Contents API ...")
        gh(
            "PUT",
            f"{repo_endpoint}/contents/README.md",
            {
                "message": "Initialize repository",
                "content": base64.b64encode(b"# mathactivity-gaotie\n").decode("ascii"),
                "branch": BRANCH,
            },
        )
        ref = gh("GET", f"{repo_endpoint}/git/ref/heads/{BRANCH}")
        parent = ref["object"]["sha"]
        print(f"Parent commit: {parent[:12]}")

    tree = []
    for relative in FILES:
        path = ROOT / relative
        if not path.is_file():
            raise SystemExit(f"missing file: {relative}")
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        blob = gh(
            "POST",
            f"{repo_endpoint}/git/blobs",
            {"content": data, "encoding": "base64"},
        )
        tree.append(
            {
                "path": relative,
                "mode": "100644",
                "type": "blob",
                "sha": blob["sha"],
            }
        )
        print(f"  uploaded {relative} ({path.stat().st_size:,} bytes)")

    tree_response = gh("POST", f"{repo_endpoint}/git/trees", {"tree": tree})
    tree_sha = tree_response["sha"]

    message = "Recalculate in km and h with basic speed formulas"
    commit_body = {"message": message, "tree": tree_sha}
    if parent:
        commit_body["parents"] = [parent]
    commit = gh("POST", f"{repo_endpoint}/git/commits", commit_body)
    commit_sha = commit["sha"]
    print(f"Commit: {commit_sha}")

    if parent:
        gh(
            "PATCH",
            f"{repo_endpoint}/git/refs/heads/{BRANCH}",
            {"sha": commit_sha, "force": False},
        )
    else:
        gh(
            "POST",
            f"{repo_endpoint}/git/refs",
            {"ref": f"refs/heads/{BRANCH}", "sha": commit_sha},
        )
    print(f"Branch {BRANCH} -> {commit_sha[:12]}")

    pages_endpoint = f"{repo_endpoint}/pages"
    pages = None
    try:
        pages = gh("GET", pages_endpoint)
    except GhError as error:
        if "Not Found" not in error.message:
            raise

    source = {"branch": BRANCH, "path": "/"}
    if pages is None:
        gh("POST", pages_endpoint, {"source": source})
    else:
        current = pages.get("source", {})
        if current.get("branch") != BRANCH or current.get("path") != "/":
            gh("PUT", pages_endpoint, {"source": source})
        else:
            print("Pages already configured.")

    print("Waiting for the Pages build ...")
    final = None
    for _ in range(30):
        time.sleep(6)
        try:
            payload = gh("GET", pages_endpoint)
        except GhError:
            continue
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
