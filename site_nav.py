#!/usr/bin/env python3
"""Inject the shared 朔元 tab bar into every board page.

Pages keep a ``<!--SITE_NAV-->`` marker (or an already-injected
``<style>.stab…</style><nav class="stab">…</nav>`` block). Edit GROUPS
below, then run::

    python3 site_nav.py

Relative hrefs are computed from each HTML file so the same GROUPS list
works at the repo root, one level down (``us/``), or two (``pages/ai-evo/``).
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# (label, path-to-index.html, optional show_sub)
# A group with a single page and show_sub=False renders only the top row
# (current A股 / 大盘 style). show_sub=True always shows the child row
# so a one-page group can still name the board (研究 / 模型/AI探索).
GROUPS = [
    {
        "label": "A股",
        "show_sub": False,
        "pages": [
            {"label": "大盘", "path": "market/index.html"},
        ],
    },
    {
        "label": "美股",
        "show_sub": True,
        "pages": [
            {"label": "美股复盘", "path": "us/index.html"},
            {"label": "估值", "path": "val/index.html"},
        ],
    },
    {
        "label": "选股",
        "show_sub": True,
        "pages": [
            {"label": "10日新高", "path": "index.html"},
            {"label": "上穿EMA", "path": "ema-x/index.html"},
            {"label": "EMA上方", "path": "ema-up/index.html"},
            {"label": "题材", "path": "theme/index.html"},
        ],
    },
    {
        "label": "研究",
        "show_sub": True,
        "pages": [
            {"label": "模型/AI探索", "path": "pages/ai-evo/index.html"},
        ],
    },
]

STAB_CSS = (
    ".stab{background:#FFFFFF;border-top:2px solid #1A3A6B;border-bottom:1px solid #E5E2DA;"
    "padding:env(safe-area-inset-top) max(10px,env(safe-area-inset-right)) 0 max(10px,env(safe-area-inset-left))}"
    ".stab .stab-g,.stab .stab-s{max-width:1180px;margin:0 auto;display:flex;gap:4px}"
    ".stab .stab-g a,.stab .stab-s a{flex:0 1 auto;display:block;padding:0 16px;height:44px;line-height:44px;"
    "font-size:15.5px;font-weight:600;color:#666666;text-decoration:none;border-bottom:3px solid transparent;"
    "white-space:nowrap;-webkit-tap-highlight-color:transparent}"
    ".stab .stab-g a.on{color:#1A3A6B;border-bottom-color:#1A3A6B}"
    ".stab .stab-s{border-top:1px solid #E5E2DA;background:#FBF9F4}"
    ".stab .stab-s a{height:38px;line-height:38px;font-size:14px;font-weight:600;color:#666666}"
    ".stab .stab-s a.on{color:#1A3A6B;border-bottom-color:#1A3A6B}"
    "@media (max-width:759px){.stab .stab-g a,.stab .stab-s a{flex:1;text-align:center;padding:0 2px;font-size:13px}"
    ".stab .stab-s a{font-size:12.5px;height:36px;line-height:36px}}"
    "@media (max-width:420px){.stab .stab-g,.stab .stab-s{gap:0}.stab .stab-g a{font-size:13px;padding:0 1px}"
    ".stab .stab-s a{font-size:12px;padding:0 1px}}"
    "@media (max-width:350px){.stab .stab-g a,.stab .stab-s a{font-size:11px}}"
)

NAV_RE = re.compile(
    r"(?:<!--SITE_NAV-->\s*)?(?:<style>\.stab\{.*?</style>\s*)?<nav class=\"stab\"[^>]*>.*?</nav>",
    re.DOTALL,
)
BARE_MARK = "<!--SITE_NAV-->"


def href_to(from_html: str, to_html: str) -> str:
    from_dir = os.path.dirname(from_html) or "."
    to_dir = os.path.dirname(to_html) or "."
    rel = os.path.relpath(to_dir, from_dir)
    if rel == ".":
        return "./"
    return rel.replace("\\", "/") + "/"


def find_current(rel_html: str):
    rel_html = rel_html.replace("\\", "/")
    for gi, g in enumerate(GROUPS):
        for pi, p in enumerate(g["pages"]):
            if p["path"] == rel_html:
                return gi, pi
    return None, None


def render_nav(rel_html: str) -> str:
    gi, pi = find_current(rel_html)
    g_parts = []
    for i, g in enumerate(GROUPS):
        href = href_to(rel_html, g["pages"][0]["path"])
        on = i == gi
        cls = ' class="on"' if on else ""
        ac = ' aria-current="page"' if on and not g["show_sub"] else ""
        g_parts.append(f'<a href="{href}"{cls}{ac}>{g["label"]}</a>')
    g_html = (
        '<div class="stab-g" role="navigation" aria-label="大类">'
        + "".join(g_parts)
        + "</div>"
    )

    s_html = ""
    if gi is not None and GROUPS[gi]["show_sub"]:
        s_parts = []
        for j, p in enumerate(GROUPS[gi]["pages"]):
            href = href_to(rel_html, p["path"])
            on = j == pi
            cls = ' class="on"' if on else ""
            ac = ' aria-current="page"' if on else ""
            s_parts.append(f'<a href="{href}"{cls}{ac}>{p["label"]}</a>')
        s_html = (
            '<div class="stab-s" role="navigation" aria-label="子看板">'
            + "".join(s_parts)
            + "</div>"
        )

    return (
        "<!--SITE_NAV-->"
        f"<style>{STAB_CSS}</style>"
        f'<nav class="stab" aria-label="看板分类">{g_html}{s_html}</nav>'
    )


def iter_pages():
    seen = set()
    for g in GROUPS:
        for p in g["pages"]:
            if p["path"] not in seen:
                seen.add(p["path"])
                yield p["path"]


def apply_file(rel_html: str) -> bool:
    path = os.path.join(ROOT, rel_html)
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    block = render_nav(rel_html)
    new, n = NAV_RE.subn(block, text, count=1)
    if n == 0:
        if BARE_MARK in text:
            new = text.replace(BARE_MARK, block, 1)
        else:
            raise SystemExit(f"{rel_html}: no <!--SITE_NAV--> / stab nav block found")
    if new == text:
        return False
    with open(path, "w", encoding="utf-8") as f:
        f.write(new)
    return True


def check() -> int:
    errors = []
    for rel in iter_pages():
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            errors.append(f"missing {rel}")
            continue
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        for label in ("A股", "美股", "选股", "研究"):
            if f">{label}<" not in text:
                errors.append(f"{rel}: missing group {label}")
        gi, _ = find_current(rel)
        if gi is None:
            errors.append(f"{rel}: not in GROUPS")
        elif GROUPS[gi]["label"] == "研究" and "模型/AI探索" not in text:
            errors.append(f"{rel}: missing 模型/AI探索")
    # path sanity
    cases = [
        ("index.html", "market/index.html", "market/"),
        ("index.html", "index.html", "./"),
        ("market/index.html", "us/index.html", "../us/"),
        ("pages/ai-evo/index.html", "market/index.html", "../../market/"),
        ("pages/ai-evo/index.html", "index.html", "../../"),
        ("pages/ai-evo/index.html", "pages/ai-evo/index.html", "./"),
    ]
    for src, dst, want in cases:
        got = href_to(src, dst)
        if got != want:
            errors.append(f"href_to({src},{dst})={got!r} want {want!r}")
    if errors:
        print("FAIL")
        for e in errors:
            print(" ", e)
        return 1
    print("ok", len(list(iter_pages())), "pages")
    return 0


def main(argv: list[str]) -> int:
    if argv[1:] == ["--check"]:
        return check()
    changed = []
    for rel in iter_pages():
        if apply_file(rel):
            changed.append(rel)
    print("updated", len(changed), "of", len(list(iter_pages())))
    for rel in changed:
        print(" ", rel)
    return check()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
