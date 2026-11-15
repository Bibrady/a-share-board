#!/usr/bin/env python3
"""Copy explorer snapshots into pages/ai-evo/data/ for the GitHub Pages board.

The public page only sees committed JSON. Local explorer updates stay invisible
until this script copies them into the repo (and, to move the live site,
commits + pushes).

Usage:
  python3 sync_ai_evo_dashboard.py --from /path/to/explorer/out
  python3 sync_ai_evo_dashboard.py --progress P.json --trials T.json
  python3 sync_ai_evo_dashboard.py --from DIR --commit --push
  python3 sync_ai_evo_dashboard.py --from DIR --watch 60 --commit --push

Env:
  AI_EVO_SRC   default --from directory (or a progress.json path)
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_DEST = ROOT / "pages" / "ai-evo" / "data"


def die(msg: str, code: int = 2) -> None:
    print(f"sync_ai_evo_dashboard: {msg}", file=sys.stderr)
    raise SystemExit(code)


def load_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        die(f"missing {path}")
    except json.JSONDecodeError as e:
        die(f"invalid JSON {path}: {e}")
    return None


def resolve_sources(args: argparse.Namespace) -> tuple[Path, Path | None]:
    src = args.src_from or os.environ.get("AI_EVO_SRC")
    progress = args.progress
    trials = args.trials
    if src:
        src_path = Path(src).expanduser().resolve()
        if src_path.is_file():
            if progress:
                die("do not pass both --from FILE and --progress")
            progress = src_path
            if trials is None:
                sibling = src_path.with_name("trials.json")
                if sibling.is_file():
                    trials = sibling
        elif src_path.is_dir():
            if progress is None:
                progress = src_path / "progress.json"
            if trials is None:
                cand = src_path / "trials.json"
                if cand.is_file():
                    trials = cand
        else:
            die(f"--from not found: {src_path}")
    if progress is None:
        die("need --from DIR/FILE or --progress FILE (or set AI_EVO_SRC)")
    progress = Path(progress).expanduser().resolve()
    trials_path = Path(trials).expanduser().resolve() if trials else None
    if not progress.is_file():
        die(f"progress not found: {progress}")
    if trials_path is not None and not trials_path.is_file():
        die(f"trials not found: {trials_path}")
    return progress, trials_path


def atomic_copy(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".tmp")
    shutil.copy2(src, tmp)
    tmp.replace(dest)


def stamp_of(data: object) -> str:
    if isinstance(data, dict):
        if data.get("updated_at") not in (None, ""):
            return str(data["updated_at"])
        return f"{data.get('evals_done', '')}"
    return ""


def files_differ(a: Path, b: Path) -> bool:
    if not b.exists():
        return True
    return a.read_bytes() != b.read_bytes()


def git(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        text=True,
        capture_output=True,
        check=False,
    )


def commit_and_push(dest_dir: Path, progress_data: object, do_commit: bool, do_push: bool) -> None:
    if not do_commit and not do_push:
        return
    repo = dest_dir
    while repo != repo.parent and not (repo / ".git").exists():
        repo = repo.parent
    if not (repo / ".git").exists():
        die("not inside a git repo; cannot --commit/--push")
    rels = [
        str((dest_dir / "progress.json").relative_to(repo)),
        str((dest_dir / "trials.json").relative_to(repo)),
    ]
    add = git(["add", "--", *rels], repo)
    if add.returncode != 0:
        die(add.stderr.strip() or "git add failed")
    stamped = stamp_of(progress_data) or "now"
    evals = ""
    if isinstance(progress_data, dict) and progress_data.get("evals_done") is not None:
        evals = f" ({progress_data['evals_done']} evals)"
    msg = f"sync ai-evo dashboard {stamped}{evals}"
    staged = git(["diff", "--cached", "--quiet", "--", *rels], repo)
    if staged.returncode == 0:
        print("sync_ai_evo_dashboard: nothing new to commit")
        return
    if do_commit:
        cm = git(["commit", "-m", msg, "--", *rels], repo)
        if cm.returncode != 0:
            die(cm.stderr.strip() or cm.stdout.strip() or "git commit failed")
        print(f"sync_ai_evo_dashboard: committed {msg}")
    if do_push:
        br = git(["rev-parse", "--abbrev-ref", "HEAD"], repo)
        branch = (br.stdout or "HEAD").strip()
        ps = git(["push", "-u", "origin", branch], repo)
        if ps.returncode != 0:
            die(ps.stderr.strip() or "git push failed")
        print(f"sync_ai_evo_dashboard: pushed {branch}")


def sync_once(args: argparse.Namespace) -> bool:
    progress, trials = resolve_sources(args)
    dest_dir = Path(args.dest).expanduser().resolve()
    dest_p = dest_dir / "progress.json"
    dest_t = dest_dir / "trials.json"
    data = load_json(progress)
    if not isinstance(data, dict):
        die(f"{progress} must be a JSON object")
    if not data.get("updated_at"):
        die(f"{progress} missing updated_at (board uses it to detect stale snapshots)")
    changed = files_differ(progress, dest_p)
    if trials is not None:
        changed = changed or files_differ(trials, dest_t)
    if args.dry_run:
        print(
            f"sync_ai_evo_dashboard: dry-run "
            f"{'COPY' if changed else 'unchanged'} "
            f"updated_at={data.get('updated_at')} "
            f"evals_done={data.get('evals_done')} "
            f"-> {dest_dir}"
        )
        return changed
    atomic_copy(progress, dest_p)
    copied = [f"progress.json updated_at={data.get('updated_at')} evals_done={data.get('evals_done')}"]
    if trials is not None:
        atomic_copy(trials, dest_t)
        copied.append("trials.json")
    print("sync_ai_evo_dashboard: wrote " + "; ".join(copied))
    print(
        "sync_ai_evo_dashboard: 站上刷新只读仓库快照；"
        "未 --push 则 GitHub Pages 不会变"
    )
    commit_and_push(dest_dir, data, args.commit, args.push)
    return changed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="sync_ai_evo_dashboard",
        description="Copy explorer progress.json / trials.json into the Pages data dir.",
    )
    p.add_argument("--from", dest="src_from", help="explorer output dir or progress.json")
    p.add_argument("--progress", help="path to progress.json")
    p.add_argument("--trials", help="path to trials.json")
    p.add_argument("--dest", default=str(DEFAULT_DEST), help="destination data dir")
    p.add_argument("--commit", action="store_true", help="git commit the copied JSON")
    p.add_argument("--push", action="store_true", help="git push after commit")
    p.add_argument("--watch", type=float, metavar="SEC", help="repeat every SEC seconds")
    p.add_argument("--dry-run", action="store_true", help="print what would be copied")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.push and not args.commit:
        args.commit = True
    if args.watch is not None:
        if args.watch <= 0:
            die("--watch must be > 0")
        while True:
            try:
                sync_once(args)
            except SystemExit as e:
                if e.code not in (0, None):
                    print(f"sync_ai_evo_dashboard: watch error, will retry ({e})", file=sys.stderr)
            time.sleep(args.watch)
    sync_once(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
