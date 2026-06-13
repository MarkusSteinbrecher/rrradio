#!/usr/bin/env python3
"""
Multi-page HTML spec site generator for rrradio.

Reads the CANONICAL markdown spec tree at docs/spec/ and emits a static,
multi-page HTML site with a grouped sidebar, per-page "on this page" TOC, and
client-side search — no third-party deps, no network, no build system. Output
lands in tools/spec-site/out/ (gitignored).

Served locally by the Vite dev server (the same server that hosts the station
tracker) at http://localhost:5173/spec/ — see the `specSite()` plugin in
vite.config.ts, which regenerates when a spec source changes. The rrradio-ios
repo carries a read-only mirror of docs/spec (scripts/sync-spec.sh there); the
prototype this was promoted from lives at rrradio-ios/build/spec-site/ and is
superseded by this copy.

The markdown converter is a pragmatic GFM subset (headings, fenced code, GFM
tables, nested lists, blockquotes, bold/italic/code/links).

    npm run spec-site                      # regenerate tools/spec-site/out/
    python3 tools/spec-site/generate.py    # same thing
"""
from __future__ import annotations
import hashlib
import html
import json
import re
import shutil
import struct
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]                 # repo root
SPEC = ROOT / "docs" / "spec"
OUT = HERE / "out"
ASSETS = OUT / "assets"
IMG_DIR = ASSETS / "img"

# Set per-page in build() before converting, so the image handler can resolve
# relative srcs and emit root-relative URLs without threading state everywhere.
CURRENT_ROOT = ""
CURRENT_SRCDIR: Path = SPEC
_copied_imgs: dict = {}

# Ordered nav. Group -> list of relpaths (relative to docs/spec).
NAV = [
    ("Overview", ["README.md", "platforms.md", "playback.md", "data-sync.md"]),
    ("Features", [
        "features/browse.md", "features/search.md", "features/favorites.md",
        "features/station-lists.md", "features/custom-stations.md",
        "features/now-playing.md", "features/metadata-artwork.md",
        "features/sleep-timer.md", "features/wake-to-radio.md",
        "features/listening-history.md", "features/watch-remote.md",
        "features/siri-shortcuts.md", "features/first-run-offline.md",
        "features/preferences-diagnostics.md",
    ]),
    ("Contracts", [
        "contracts/catalog-schema.md", "contracts/playback-state-machine.md",
        "contracts/metadata-fetchers.md", "contracts/search.md",
        "contracts/sync-merge.md", "contracts/privacy-data-boundaries.md",
        "contracts/watch-protocol.md", "contracts/localization.md",
    ]),
    ("Authoring", ["STYLE.md", "COVERAGE.md"]),
]

def url_for(relpath: str) -> str:
    if relpath == "README.md":
        return "index.html"
    return re.sub(r"\.md$", ".html", relpath)


def depth_of(relpath: str) -> int:
    return url_for(relpath).count("/")


def root_prefix(relpath: str) -> str:
    return "../" * depth_of(relpath)


# ----------------------------------------------------------------------------
# Markdown -> HTML (pragmatic GFM subset)
# ----------------------------------------------------------------------------

def strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s)


def md_plain(txt: str) -> str:
    """Raw, UNescaped text with inline markdown removed (links -> label, drop
    `*_ markers). Used for nav titles, TOC entries, and the search index, all of
    which escape exactly once at render time."""
    txt = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", txt)
    return re.sub(r"[`*_]", "", txt).strip()


# ----------------------------------------------------------------------------
# Images / figures
# ----------------------------------------------------------------------------

def _image_size(path: Path):
    """(w, h) for PNG and SVG, else None — used for portrait detection."""
    try:
        if path.suffix.lower() == ".svg":
            txt = path.read_text(errors="ignore")[:1200]
            m = re.search(r'viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"', txt)
            if m:
                return float(m.group(1)), float(m.group(2))
            mw, mh = re.search(r'width="([\d.]+)', txt), re.search(r'height="([\d.]+)', txt)
            return (float(mw.group(1)), float(mh.group(1))) if mw and mh else None
        with open(path, "rb") as f:
            head = f.read(26)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", head[16:24])
            return float(w), float(h)
    except Exception:
        return None
    return None


def _copy_image(path: Path) -> str:
    """Copy into out/assets/img/ once; return the site-relative path (no root prefix)."""
    key = str(path.resolve())
    if key not in _copied_imgs:
        IMG_DIR.mkdir(parents=True, exist_ok=True)
        h = hashlib.sha1(key.encode()).hexdigest()[:8]
        name = re.sub(r"[^A-Za-z0-9._-]", "-", path.stem) + "-" + h + path.suffix.lower()
        shutil.copy(path, IMG_DIR / name)
        _copied_imgs[key] = "assets/img/" + name
    return _copied_imgs[key]


def _resolve_src(src: str):
    for base in (CURRENT_SRCDIR, ROOT):
        p = base / src
        if p.exists():
            return p
    return None


def render_image(alt: str, src: str, title: str, block: bool) -> str:
    alt_e = html.escape(alt)
    if src.startswith(("http://", "https://", "data:")):
        inner = f'<img src="{src}" alt="{alt_e}" loading="lazy">'
        return _wrap_figure(inner, title or alt, False) if block else inner

    path = _resolve_src(src)
    if not path:
        miss = f'<span class="img-missing">[missing image: {html.escape(src)}]</span>'
        return (f'<figure class="figure">{miss}'
                f'<figcaption>{html.escape(title or alt)}</figcaption></figure>') if block else miss

    light = CURRENT_ROOT + _copy_image(path)
    size = _image_size(path)
    portrait = bool(size and size[1] > size[0] * 1.25)
    dark = path.with_name(path.stem + "-dark" + path.suffix)
    if dark.exists():
        dark_rel = CURRENT_ROOT + _copy_image(dark)
        inner = (f'<picture><source srcset="{dark_rel}" media="(prefers-color-scheme: dark)">'
                 f'<img src="{light}" alt="{alt_e}" loading="lazy"></picture>')
    else:
        inner = f'<img src="{light}" alt="{alt_e}" loading="lazy">'
    return _wrap_figure(inner, title or alt, portrait) if block else inner


def _wrap_figure(inner: str, caption: str, portrait: bool) -> str:
    cls = "figure fig-portrait" if portrait else "figure"
    cap = f"<figcaption>{html.escape(caption)}</figcaption>" if caption else ""
    return f'<figure class="{cls}">{inner}{cap}</figure>'


IMG_INLINE_RE = re.compile(r'!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)')
IMG_BLOCK_RE = re.compile(r'^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$')


def slugify(text: str, seen: set) -> str:
    t = strip_tags(text).lower()
    t = re.sub(r"[`*_]", "", t)
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    if not t:
        t = "section"
    base = t
    n = 2
    while t in seen:
        t = f"{base}-{n}"
        n += 1
    seen.add(t)
    return t


def rewrite_href(href: str) -> str:
    if href.startswith(("http://", "https://", "mailto:", "#")):
        return href
    # foo.md / foo.md#anchor -> foo.html(/#anchor); README.md -> index.html
    href = re.sub(r"README\.md(?=$|#)", "index.html", href)
    href = re.sub(r"\.md(?=$|#)", ".html", href)
    return href


def inline(text: str) -> str:
    codes: list[str] = []
    imgs: list[str] = []

    def img_sub(m):
        imgs.append(render_image(m.group(1), m.group(2), m.group(3) or "", block=False))
        return f"\x00I{len(imgs) - 1}\x00"

    def code_sub(m):
        codes.append(m.group(1))
        return f"\x00C{len(codes) - 1}\x00"

    text = IMG_INLINE_RE.sub(img_sub, text)
    text = re.sub(r"`([^`]+)`", code_sub, text)
    text = html.escape(text, quote=False)

    def link_sub(m):
        label, href = m.group(1), rewrite_href(m.group(2))
        ext = ' target="_blank" rel="noopener"' if href.startswith(("http://", "https://")) else ""
        return f'<a href="{href}"{ext}>{label}</a>'

    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link_sub, text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])", r"<em>\1</em>", text)
    text = re.sub(r"(?<!\w)_(?=\S)([^_\n]+?)(?<=\S)_(?!\w)", r"<em>\1</em>", text)
    text = re.sub(r"\x00C(\d+)\x00",
                  lambda m: "<code>" + html.escape(codes[int(m.group(1))], quote=False) + "</code>",
                  text)
    text = re.sub(r"\x00I(\d+)\x00", lambda m: imgs[int(m.group(1))], text)
    return text


def leading_spaces(s: str) -> int:
    return len(s) - len(s.lstrip(" "))


LIST_RE = re.compile(r"^\s*([-*+]|\d+[.)])\s+")


def is_list_item(s: str) -> bool:
    return bool(LIST_RE.match(s))


def is_table_delim(s: str) -> bool:
    s = s.strip()
    if "|" not in s:
        return False
    cells = [c.strip() for c in s.strip("|").split("|")]
    cells = [c for c in cells if c]
    return len(cells) >= 1 and all(re.match(r"^:?-{2,}:?$", c) for c in cells)


def split_row(line: str) -> list[str]:
    line = line.replace(r"\|", "\x00P\x00").strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip().replace("\x00P\x00", "|") for c in line.split("|")]


def aligns_from(delim: str) -> list[str]:
    out = []
    for c in split_row(delim):
        left, right = c.startswith(":"), c.endswith(":")
        out.append("center" if left and right else "right" if right else "left")
    return out


def render_table(header: str, delim: str, body: list[str]) -> str:
    heads = split_row(header)
    aligns = aligns_from(delim)
    cols = len(heads)

    def cell(tag, txt, i):
        a = aligns[i] if i < len(aligns) else "left"
        style = f' style="text-align:{a}"' if a != "left" else ""
        return f"<{tag}{style}>{inline(txt)}</{tag}>"

    out = ['<div class="table-wrap"><table><thead><tr>']
    out += [cell("th", h, i) for i, h in enumerate(heads)]
    out.append("</tr></thead><tbody>")
    for row in body:
        cells = split_row(row)
        cells = (cells + [""] * cols)[:cols]
        out.append("<tr>" + "".join(cell("td", c, i) for i, c in enumerate(cells)) + "</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


def render_list(lines: list[str]) -> str:
    lines = [l for l in lines if l.strip() != ""]
    if not lines:
        return ""
    base = min(leading_spaces(l) for l in lines if is_list_item(l))
    ordered = bool(re.match(r"^\s*\d+[.)]\s", lines[0]))

    # group into items by a list marker at the base indent
    items: list[list[str]] = []
    buf: list[str] = []
    for l in lines:
        if is_list_item(l) and leading_spaces(l) == base:
            if buf:
                items.append(buf)
            buf = [l]
        else:
            buf.append(l)
    if buf:
        items.append(buf)

    html_items = []
    for it in items:
        m = LIST_RE.match(it[0])
        content = it[0][m.end():]
        cont = [content]
        nested: list[str] = []
        in_nested = False
        for r in it[1:]:
            if is_list_item(r) and leading_spaces(r) > base:
                in_nested = True
            if in_nested:
                nested.append(r)
            else:
                cont.append(r.strip())
        text = " ".join(x.strip() for x in cont if x.strip())
        cb = ""
        mt = re.match(r"^\[([ xX])\]\s+(.*)$", text)
        if mt:
            checked = " checked" if mt.group(1).lower() == "x" else ""
            cb = f'<input type="checkbox" disabled{checked}> '
            text = mt.group(2)
        li = cb + inline(text)
        if nested:
            li += render_list(nested)
        html_items.append(f"<li>{li}</li>")
    tag = "ol" if ordered else "ul"
    cls = ' class="task-list"' if any("checkbox" in h for h in html_items) else ""
    return f"<{tag}{cls}>" + "".join(html_items) + f"</{tag}>"


def starts_block(line: str) -> bool:
    return (line.strip() == "" or line.startswith(("#", ">", "```"))
            or line.lstrip().startswith("![")
            or is_list_item(line) or re.match(r"^(-{3,}|\*{3,}|_{3,})\s*$", line)
            or "|" in line)


def convert(md: str):
    lines = md.split("\n")
    # strip the mirror banner (leading blockquote that mentions GENERATED MIRROR)
    if lines and lines[0].startswith(">") and "GENERATED MIRROR" in lines[0]:
        i = 0
        while i < len(lines) and lines[i].startswith(">"):
            i += 1
        while i < len(lines) and lines[i].strip() == "":
            i += 1
        lines = lines[i:]

    out, headings, plain = [], [], []
    seen_slugs: set = set()
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        if line.strip() == "":
            i += 1
            continue

        m = re.match(r"^```(\w*)\s*$", line)
        if m:
            lang, j, buf = m.group(1), i + 1, []
            while j < n and not re.match(r"^```\s*$", lines[j]):
                buf.append(lines[j])
                j += 1
            if j >= n:
                # Unterminated fence — don't swallow to EOF. (Upstream STYLE.md
                # nests ``` template examples, which leaves a dangling opener.)
                # Skip the lone opener and keep parsing the rest as markdown.
                i += 1
                continue
            code = html.escape("\n".join(buf), quote=False)
            cls = f' class="language-{lang}"' if lang else ""
            out.append(f"<pre><code{cls}>{code}</code></pre>")
            i = j + 1
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            level, txt = len(m.group(1)), m.group(2).strip()
            inner = inline(txt)
            hid = slugify(txt, seen_slugs)
            out.append(f'<h{level} id="{hid}">{inner}'
                       f'<a class="anchor" href="#{hid}" aria-label="Permalink">#</a></h{level}>')
            if level in (2, 3):
                headings.append({"level": level, "text": md_plain(txt), "id": hid})
            plain.append(txt)
            i += 1
            continue

        mimg = IMG_BLOCK_RE.match(line)
        if mimg:
            out.append(render_image(mimg.group(1), mimg.group(2), mimg.group(3) or "", block=True))
            plain.append(mimg.group(1))
            i += 1
            continue

        if re.match(r"^(-{3,}|\*{3,}|_{3,})\s*$", line):
            out.append("<hr>")
            i += 1
            continue

        if "|" in line and i + 1 < n and is_table_delim(lines[i + 1]):
            delim, j, body = lines[i + 1], i + 2, []
            while j < n and lines[j].strip() != "" and "|" in lines[j]:
                body.append(lines[j])
                j += 1
            out.append(render_table(line, delim, body))
            plain.append(strip_tags(inline(line)))
            i = j
            continue

        if line.startswith(">"):
            j, buf = i, []
            while j < n and lines[j].startswith(">"):
                buf.append(re.sub(r"^>\s?", "", lines[j]))
                j += 1
            inner, _, _ = convert("\n".join(buf))
            out.append(f"<blockquote>{inner}</blockquote>")
            i = j
            continue

        if is_list_item(line):
            j, block = i, []
            while j < n:
                if lines[j].strip() == "":
                    k = j + 1
                    while k < n and lines[k].strip() == "":
                        k += 1
                    if k < n and (is_list_item(lines[k]) or leading_spaces(lines[k]) > 0):
                        block.append(lines[j])
                        j += 1
                        continue
                    break
                if is_list_item(lines[j]) or leading_spaces(lines[j]) > 0:
                    block.append(lines[j])
                    j += 1
                    continue
                break
            out.append(render_list(block))
            plain += [l.strip() for l in block]
            i = j
            continue

        # paragraph
        buf, j = [line], i + 1
        while j < n and lines[j].strip() != "" and not starts_block(lines[j]):
            buf.append(lines[j])
            j += 1
        para = " ".join(s.strip() for s in buf)
        out.append(f"<p>{inline(para)}</p>")
        plain.append(para)
        i = j

    return "\n".join(out), headings, " ".join(plain)


# ----------------------------------------------------------------------------
# Page assembly
# ----------------------------------------------------------------------------

def title_of(relpath: str, body_md: str) -> str:
    # First H1 from the raw markdown, stripped of inline formatting. Returned
    # UNescaped — callers (nav, <title>, search) escape exactly once.
    for line in body_md.split("\n"):
        m = re.match(r"^#\s+(.*)$", line)
        if m:
            return md_plain(m.group(1).strip())
    return relpath


def nav_html(current: str) -> str:
    rp = root_prefix(current)
    parts = ['<nav class="sidebar-nav">']
    for group, items in NAV:
        parts.append(f'<div class="nav-group"><div class="nav-group-title">{group}</div><ul>')
        for relpath in items:
            if relpath not in PAGES:
                continue
            cls = ' class="active"' if relpath == current else ""
            href = rp + url_for(relpath)
            parts.append(f'<li{cls}><a href="{href}">{html.escape(PAGES[relpath]["title"])}</a></li>')
        parts.append("</ul></div>")
    parts.append("</nav>")
    return "".join(parts)


def toc_html(headings) -> str:
    if not headings:
        return ""
    parts = ['<aside class="toc"><div class="toc-title">On this page</div><ul>']
    for h in headings:
        parts.append(f'<li class="lvl{h["level"]}"><a href="#{h["id"]}">{html.escape(h["text"])}</a></li>')
    parts.append("</ul></aside>")
    return "".join(parts)


PAGE_TMPL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · rrradio spec</title>
<link rel="stylesheet" href="{root}assets/style.css">
<script>window.SPEC_ROOT="{root}";</script>
</head>
<body>
<header class="topbar">
  <button class="menu-btn" aria-label="Menu" onclick="document.body.classList.toggle('nav-open')">☰</button>
  <a class="brand" href="{root}index.html">
    <img class="brand-logo light" src="{root}assets/logo-light.svg" alt="rrradio" width="28" height="28">
    <img class="brand-logo dark" src="{root}assets/logo-dark.svg" alt="" width="28" height="28" aria-hidden="true">
    <span class="brand-text">rrradio <span>spec</span></span>
  </a>
  <div class="search">
    <input id="search-input" type="search" placeholder="Search the spec…  ( / )" autocomplete="off" aria-label="Search">
    <div id="search-results" class="search-results" hidden></div>
  </div>
</header>
<div class="layout">
  <div class="sidebar">{nav}</div>
  <main class="content">
    <article class="markdown">{body}</article>
    <footer class="page-footer">
      <p>Generated prototype — built from the read-only spec mirror at
      <code>docs/spec</code> (upstream <code>{commit}</code>). Canonical source is
      <code>rrradio/docs/spec</code> in the web repo; this is for evaluating layout only.</p>
    </footer>
  </main>
  {toc}
</div>
<div class="scrim" onclick="document.body.classList.remove('nav-open')"></div>
<div class="lightbox" id="lightbox" aria-hidden="true"><img alt=""></div>
<script src="{root}assets/search-index.js"></script>
<script src="{root}assets/search.js"></script>
<script>
(function(){{var lb=document.getElementById('lightbox');if(!lb)return;var im=lb.querySelector('img');
function close(){{lb.classList.remove('open');lb.setAttribute('aria-hidden','true');im.removeAttribute('src');}}
document.addEventListener('click',function(e){{var t=e.target;
  if(t.tagName==='IMG'&&t.closest('figure')){{im.src=t.currentSrc||t.src;lb.classList.add('open');lb.setAttribute('aria-hidden','false');}}
  else if(lb.classList.contains('open')){{close();}}
}});
document.addEventListener('keydown',function(e){{if(e.key==='Escape'&&lb.classList.contains('open'))close();}});
}})();
</script>
</body>
</html>
"""


STYLE_CSS = """
:root{
  --bg:#ffffff; --fg:#1f2328; --muted:#656d76; --border:#d0d7de; --soft:#f6f8fa;
  --accent:#0969da; --accent-soft:#ddf4ff; --code-bg:#f6f8fa; --sidebar:#fbfcfd;
  --maxw:820px; --side:264px; --toc:216px;
}
@media (prefers-color-scheme: dark){
  :root{ --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --border:#30363d; --soft:#161b22;
    --accent:#4493f8; --accent-soft:#193552; --code-bg:#161b22; --sidebar:#0d1117; }
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);
  font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;
  background:var(--code-bg);padding:.15em .4em;border-radius:6px}
pre{background:var(--code-bg);border:1px solid var(--border);border-radius:10px;
  padding:14px 16px;overflow:auto;font-size:.85em;line-height:1.5}
pre code{background:none;padding:0;font-size:1em}

/* top bar */
.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:14px;
  height:56px;padding:0 18px;background:var(--bg);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.05rem;color:var(--fg)}
.brand:hover{text-decoration:none}
.brand-logo{width:28px;height:28px;border-radius:7px;display:block;flex:none;
  box-shadow:0 0 0 1px var(--border)}
.brand-logo.dark{display:none}
.brand-text span{color:var(--muted);font-weight:600}
@media (prefers-color-scheme: dark){ .brand-logo.light{display:none} .brand-logo.dark{display:block} }
.menu-btn{display:none;background:none;border:0;font-size:1.4rem;color:var(--fg);cursor:pointer}
.search{position:relative;margin-left:auto;width:min(420px,42vw)}
#search-input{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;
  background:var(--soft);color:var(--fg);font-size:.92rem}
#search-input:focus{outline:2px solid var(--accent);border-color:transparent}
.search-results{position:absolute;top:44px;right:0;width:min(520px,86vw);max-height:62vh;overflow:auto;
  background:var(--bg);border:1px solid var(--border);border-radius:10px;
  box-shadow:0 12px 40px rgba(0,0,0,.18);padding:6px}
.search-results a{display:block;padding:9px 11px;border-radius:7px;color:var(--fg)}
.search-results a:hover,.search-results a.sel{background:var(--accent-soft);text-decoration:none}
.search-results .r-title{font-weight:600}
.search-results .r-ctx{display:block;color:var(--muted);font-size:.83rem;margin-top:1px}
.search-results .r-group{float:right;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
.search-results .empty{padding:12px;color:var(--muted)}

/* layout */
.layout{display:grid;grid-template-columns:var(--side) minmax(0,1fr) var(--toc);
  max-width:1360px;margin:0 auto}
.sidebar{position:sticky;top:56px;align-self:start;height:calc(100vh - 56px);overflow:auto;
  border-right:1px solid var(--border);background:var(--sidebar);padding:18px 10px 40px}
.content{min-width:0;padding:30px 40px 80px}
.toc{position:sticky;top:56px;align-self:start;height:calc(100vh - 56px);overflow:auto;
  padding:30px 16px;font-size:.84rem}

/* sidebar nav */
.nav-group{margin-bottom:18px}
.nav-group-title{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);font-weight:700;padding:0 10px 6px}
.sidebar-nav ul{list-style:none;margin:0;padding:0}
.sidebar-nav li a{display:block;padding:5px 10px;border-radius:7px;color:var(--fg);font-size:.9rem}
.sidebar-nav li a:hover{background:var(--soft);text-decoration:none}
.sidebar-nav li.active a{background:var(--accent-soft);color:var(--accent);font-weight:600}

/* toc */
.toc-title{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
  font-weight:700;margin-bottom:8px}
.toc ul{list-style:none;margin:0;padding:0}
.toc li a{display:block;padding:3px 0;color:var(--muted)}
.toc li a:hover{color:var(--accent)}
.toc li.lvl3 a{padding-left:14px;font-size:.95em}

/* markdown */
.markdown{max-width:var(--maxw)}
.markdown h1{font-size:2rem;margin:.2em 0 .6em;line-height:1.2}
.markdown h2{font-size:1.4rem;margin:1.8em 0 .6em;padding-bottom:.3em;border-bottom:1px solid var(--border)}
.markdown h3{font-size:1.15rem;margin:1.5em 0 .5em}
.markdown h4{font-size:1rem;margin:1.3em 0 .4em}
.markdown h1,.markdown h2,.markdown h3,.markdown h4{scroll-margin-top:72px}
.markdown p{margin:.7em 0}
.markdown ul,.markdown ol{margin:.6em 0;padding-left:1.5em}
.markdown li{margin:.25em 0}
.markdown li>ul,.markdown li>ol{margin:.25em 0}
.markdown blockquote{margin:.8em 0;padding:.4em 1em;border-left:3px solid var(--border);color:var(--muted)}
.markdown hr{border:0;border-top:1px solid var(--border);margin:2em 0}
.task-list{list-style:none;padding-left:.2em}
.anchor{margin-left:.4em;color:var(--border);opacity:0;text-decoration:none;font-weight:400}
h1:hover .anchor,h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{opacity:1}

/* tables */
.table-wrap{overflow:auto;margin:1em 0}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{border:1px solid var(--border);padding:7px 11px;text-align:left;vertical-align:top}
thead th{background:var(--soft);font-weight:600}
tbody tr:nth-child(2n){background:var(--soft)}

/* figures */
.markdown figure.figure{margin:1.6em 0;text-align:center}
.markdown figure.figure img{max-width:100%;height:auto;border:1px solid var(--border);
  border-radius:12px;background:var(--soft);cursor:zoom-in}
.markdown figure.fig-portrait img{width:auto;max-width:300px;max-height:78vh}
.markdown figcaption{margin:.6em auto 0;max-width:62ch;color:var(--muted);
  font-size:.84rem;line-height:1.45}
.img-missing{display:inline-block;padding:8px 12px;border:1px dashed var(--border);
  border-radius:8px;color:var(--muted);font-size:.85rem}

/* lightbox */
.lightbox{position:fixed;inset:0;z-index:100;display:none;align-items:center;justify-content:center;
  background:rgba(0,0,0,.82);padding:24px;cursor:zoom-out}
.lightbox.open{display:flex}
.lightbox img{max-width:96vw;max-height:94vh;border-radius:10px;box-shadow:0 12px 50px rgba(0,0,0,.5)}

.page-footer{margin-top:60px;padding-top:18px;border-top:1px solid var(--border);
  color:var(--muted);font-size:.82rem}

.scrim{display:none;position:fixed;inset:56px 0 0;background:rgba(0,0,0,.4);z-index:18}

@media (max-width:1100px){ .layout{grid-template-columns:var(--side) minmax(0,1fr)} .toc{display:none} }
@media (max-width:820px){
  .layout{grid-template-columns:1fr}
  .menu-btn{display:block}
  .sidebar{position:fixed;top:56px;left:0;z-index:20;width:280px;transform:translateX(-100%);
    transition:transform .2s ease}
  body.nav-open .sidebar{transform:none}
  body.nav-open .scrim{display:block}
  .content{padding:22px 20px 70px}
}
"""


SEARCH_JS = r"""
(function(){
  var idx = window.SPEC_INDEX || [];
  var root = window.SPEC_ROOT || "";
  var input = document.getElementById('search-input');
  var box = document.getElementById('search-results');
  if(!input) return;
  var sel = -1, current = [];

  function score(doc, q){
    var s = 0, t = doc.title.toLowerCase();
    if(t.indexOf(q) > -1) s += t.startsWith(q) ? 60 : 40;
    for(var i=0;i<doc.headings.length;i++){
      if(doc.headings[i].text.toLowerCase().indexOf(q) > -1){ s += 18; break; }
    }
    if(doc.text.indexOf(q) > -1) s += 6;
    return s;
  }
  function ctxFor(doc, q){
    for(var i=0;i<doc.headings.length;i++){
      var h = doc.headings[i];
      if(h.text.toLowerCase().indexOf(q) > -1) return {label:h.text, frag:'#'+h.id};
    }
    var p = doc.text.indexOf(q);
    if(p > -1){ var a=Math.max(0,p-30); return {label:'…'+doc.raw.substr(a,80).trim()+'…', frag:''}; }
    return {label:'', frag:''};
  }
  function render(q){
    current = [];
    if(q.length < 2){ box.hidden = true; box.innerHTML=''; return; }
    var scored = [];
    for(var i=0;i<idx.length;i++){ var s = score(idx[i], q); if(s>0) scored.push([s,idx[i]]); }
    scored.sort(function(a,b){return b[0]-a[0];});
    scored = scored.slice(0,12);
    if(!scored.length){ box.innerHTML='<div class="empty">No matches.</div>'; box.hidden=false; return; }
    var hParts = [];
    for(var j=0;j<scored.length;j++){
      var d = scored[j][1], c = ctxFor(d, q);
      current.push(root + d.url + c.frag);
      hParts.push('<a href="'+root+d.url+c.frag+'"><span class="r-group">'+d.group+'</span>'
        +'<span class="r-title">'+esc(d.title)+'</span>'
        +(c.label?'<span class="r-ctx">'+esc(c.label)+'</span>':'')+'</a>');
    }
    box.innerHTML = hParts.join('');
    box.hidden = false; sel = -1;
  }
  function esc(s){ return s.replace(/[&<>]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }
  function move(d){
    var links = box.querySelectorAll('a'); if(!links.length) return;
    if(sel>-1) links[sel].classList.remove('sel');
    sel = (sel + d + links.length) % links.length;
    links[sel].classList.add('sel'); links[sel].scrollIntoView({block:'nearest'});
  }
  input.addEventListener('input', function(){ render(input.value.trim().toLowerCase()); });
  input.addEventListener('keydown', function(e){
    if(e.key==='ArrowDown'){ e.preventDefault(); move(1); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); move(-1); }
    else if(e.key==='Enter'){ if(current.length){ location.href = current[sel>-1?sel:0]; } }
    else if(e.key==='Escape'){ box.hidden=true; input.blur(); }
  });
  document.addEventListener('keydown', function(e){
    if(e.key==='/' && document.activeElement!==input){ e.preventDefault(); input.focus(); }
  });
  document.addEventListener('click', function(e){
    if(!box.contains(e.target) && e.target!==input) box.hidden = true;
  });
})();
"""


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    ASSETS.mkdir(parents=True)

    # Stamp pages with the repo commit the site was generated from.
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip() or "unknown"
    except Exception:
        commit = "unknown"

    global CURRENT_ROOT, CURRENT_SRCDIR

    # pass 1: load + title + source dir
    for group, items in NAV:
        for relpath in list(items):
            f = SPEC / relpath
            if not f.exists():
                print(f"  (skip missing {relpath})")
                items.remove(relpath)
                continue
            md = f.read_text()
            PAGES[relpath] = {"md": md, "title": title_of(relpath, md),
                              "group": group, "srcdir": f.parent}

    # pass 2: render + collect search index
    search_index = []
    for relpath, page in PAGES.items():
        CURRENT_ROOT = root_prefix(relpath)
        CURRENT_SRCDIR = page["srcdir"]
        body, headings, plain = convert(page["md"])
        outfile = OUT / url_for(relpath)
        outfile.parent.mkdir(parents=True, exist_ok=True)
        outfile.write_text(PAGE_TMPL.format(
            title=html.escape(page["title"]),
            root=root_prefix(relpath),
            nav=nav_html(relpath),
            body=body,
            toc=toc_html(headings),
            commit=html.escape(commit),
        ))
        norm = re.sub(r"\s+", " ", plain).strip()
        search_index.append({
            "title": page["title"], "url": url_for(relpath), "group": page["group"],
            "headings": headings,
            "text": norm.lower()[:6000],
            "raw": norm[:6000],
        })

    logo_candidates = {
        "logo-light.svg": [ROOT / "public" / "rrradio-logo-app-light.svg",
                           ROOT / "public" / "rrradio-logo-light.svg",
                           ROOT / "public" / "rrradio-logo.svg"],
        "logo-dark.svg": [ROOT / "public" / "rrradio-logo-app-dark.svg",
                          ROOT / "public" / "rrradio-logo-dark.svg"],
    }
    for name, candidates in logo_candidates.items():
        hit = next((c for c in candidates if c.exists()), None)
        if hit:
            shutil.copy(hit, ASSETS / name)
        else:
            print(f"  (warning: no logo found for {name})")

    (ASSETS / "style.css").write_text(STYLE_CSS)
    (ASSETS / "search.js").write_text(SEARCH_JS)
    (ASSETS / "search-index.js").write_text(
        "window.SPEC_INDEX=" + json.dumps(search_index, ensure_ascii=False) + ";")

    print(f"Built {len(PAGES)} pages → {OUT}")
    print(f"Open: open {OUT / 'index.html'}")


PAGES: dict = {}

if __name__ == "__main__":
    build()
