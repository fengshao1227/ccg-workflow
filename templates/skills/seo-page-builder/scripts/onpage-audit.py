#!/usr/bin/env python3
"""On-page measurement for SEO tool pages. Stdlib only, no key, no install.

Three modes, matching the three things you must never guess:

  --targets t.json     score your own pages (canonical / robots / words /
                       keyword coverage / FAQ depth)
  --benchmark URL...   measure ranking competitors with the SAME algorithm,
                       so the density target comes from evidence not memory
  --suggest SEED...    harvest real Google autocomplete for FAQ + long-tail

Density is printed two ways because the conventions disagree on multi-word
phrases, and that disagreement is what makes "aim for 2%" a trap:
  hits%  = occurrences / total_words            (what density widgets show)
  span%  = occurrences * phrase_len / total     (share of text occupied)

targets.json:
{
  "site": "https://example.com",
  "dist": "dist",                        // optional: read local build instead
  "word_floor": 1200,
  "phrase_floor": 8,
  "faq_floor": 6,
  "pages": {
    "/":       {"phrase": "widget remover", "tokens": ["widget", "remover"]},
    "/video/": {"phrase": "video widget remover", "tokens": ["widget"]}
  }
}
"""
import argparse
import html as html_mod
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"
DROP = {"script", "style", "noscript", "template", "svg"}
QUESTION_PREFIXES = ["", "how to ", "can you ", "is it ", "why does ",
                     "does ", "what is ", "how do i "]


class Page(HTMLParser):
    """Visible text, headings and FAQ count. Body text is <main> when present."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.drop = self.main = 0
        self.tag = None
        self.txt, self.all_txt, self.h1, self.heads = [], [], [], []
        self.faq = 0

    def handle_starttag(self, t, attrs):
        if t in DROP:
            self.drop += 1
        if t == "main":
            self.main += 1
        if t in ("h1", "h2", "h3", "h4"):
            self.tag = t
        if t == "summary":
            self.faq += 1

    def handle_endtag(self, t):
        if t in DROP and self.drop:
            self.drop -= 1
        if t == "main" and self.main:
            self.main -= 1
        if t in ("h1", "h2", "h3", "h4"):
            self.tag = None

    def handle_data(self, d):
        if self.drop:
            return
        self.all_txt.append(d)
        if self.main:
            self.txt.append(d)
        if self.tag == "h1":
            self.h1.append(d)
        elif self.tag:
            self.heads.append((self.tag, d.strip()))

    def body(self):
        src = self.txt or self.all_txt
        return words(re.sub(r"\s+", " ", " ".join(src)))


def words(t):
    return re.findall(r"[a-z0-9']+", t.lower())


def hits(ws, phrase):
    p = words(phrase)
    n = len(p)
    if not n or n > len(ws):
        return 0
    return sum(1 for i in range(len(ws) - n + 1) if ws[i:i + n] == p)


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def head_tag(html, name=None, rel=None):
    if rel:
        m = re.search(r'<link[^>]+rel="%s"[^>]+href="([^"]*)"' % rel, html)
    else:
        m = re.search(r'<meta[^>]+name="%s"[^>]+content="([^"]*)"' % name, html)
    return m.group(1) if m else None


def density(n, count, phrase_len=1):
    if not n:
        return 0.0, 0.0
    return 100.0 * count / n, 100.0 * count * phrase_len / n


# ---------------------------------------------------------------- own pages

def audit(cfg):
    site = cfg.get("site", "").rstrip("/")
    dist = Path(cfg["dist"]) if cfg.get("dist") else None
    wf = cfg.get("word_floor", 1200)
    pf = cfg.get("phrase_floor", 8)
    ff = cfg.get("faq_floor", 6)
    fails, warns = [], []

    for path, spec in cfg["pages"].items():
        if dist:
            f = dist / path.strip("/") / "index.html" if path.strip("/") else dist / "index.html"
            if not f.exists():
                fails.append(f"{path} not built")
                continue
            html = f.read_text(encoding="utf-8", errors="replace")
        else:
            html = fetch(site + path)

        p = Page()
        p.feed(html)
        body = p.body()
        n = len(body)
        phrase = spec["phrase"]
        ph = hits(body, phrase)
        h_pct, s_pct = density(n, ph, len(words(phrase)))
        in_h1 = hits(words(" ".join(p.h1)), phrase) > 0
        in_heads = sum(1 for _, x in p.heads if hits(words(x), phrase) > 0)

        canon = head_tag(html, rel="canonical")
        robots = head_tag(html, name="robots") or ""
        # entities must be unescaped before measuring: "&amp;" is one character
        # to Google and five to len(), which silently inflates every title.
        desc = html_mod.unescape(head_tag(html, name="description") or "")
        t = re.search(r"<title>(.*?)</title>", html, re.S)
        title = html_mod.unescape(t.group(1).strip()) if t else ""

        ok_c = (not site) or canon == site + path
        ok_r = "noindex" not in robots
        ok_w = n >= wf
        ok_p = ph >= pf
        ok_f = p.faq >= ff
        ok_t = len(title) <= 65
        ok_d = 120 <= len(desc) <= 165

        def m(b):
            return "OK " if b else "!! "

        print(f"\n### {path}   {n} words")
        print(f"  {m(ok_c)}canonical  {canon}")
        print(f"  {m(ok_r)}robots     {robots[:50] or '(none)'}")
        print(f"  {m(ok_w)}words      {n} (>= {wf})")
        print(f"  {m(ok_t)}title({len(title)})  {title[:70]}")
        print(f"  {m(ok_d)}desc({len(desc)})")
        print(f"  {m(ok_p)}phrase '{phrase}'")
        print(f"       {ph}x   hits {h_pct:.2f}%   span {s_pct:.2f}%   "
              f"H1={'y' if in_h1 else 'NO'}  headings={in_heads}")
        for tok in spec.get("tokens", []):
            td, _ = density(n, hits(body, tok))
            print(f"       token '{tok}'  {td:.2f}%")
        print(f"  {m(ok_f)}FAQ        {p.faq} (>= {ff})")

        for cond, msg in ((ok_c, "canonical"), (ok_r, "robots"), (ok_w, f"words {n}"),
                          (ok_f, f"faq {p.faq}"), (ok_t, f"title {len(title)}"),
                          (ok_d, f"desc {len(desc)}")):
            if not cond:
                fails.append(f"{path} {msg}")
        if not ok_p:
            warns.append(f"{path} phrase {ph}x (floor {pf})"
                         + ("  <-- ZERO, check H1 vs title wording" if ph == 0 else ""))
        if not in_h1:
            fails.append(f"{path} H1 does not contain '{phrase}'")

    print("\n" + "=" * 78)
    print("FAIL" if fails else "hard checks pass")
    for x in fails:
        print("  x", x)
    if warns:
        print("\ncoverage below floor — raise by naming the tool, not by adding sentences")
        for x in warns:
            print("  ~", x)
    return 1 if fails else 0


# -------------------------------------------------------------- competitors

def benchmark(urls, phrase, tokens):
    print(f"phrase: {phrase!r}   tokens: {tokens}\n")
    print(f"{'competitor':<44}{'words':>6}{'phrase':>18}{'':>4}" +
          "".join(f"{t[:14]:>16}" for t in tokens))
    rows = []
    for u in urls:
        try:
            html = fetch(u)
        except Exception as e:
            print(f"{u[:44]:<44}  fetch failed: {e}")
            continue
        p = Page()
        p.feed(html)
        body = p.body()
        n = len(body)
        if n < 50:
            print(f"{u[:44]:<44}{n:>6}  (JS-rendered, no static body)")
            continue
        ph = hits(body, phrase)
        h, s = density(n, ph, len(words(phrase)))
        cells = ""
        for t in tokens:
            td, _ = density(n, hits(body, t))
            cells += f"{td:>15.2f}%"
        print(f"{u.replace('https://', '')[:44]:<44}{n:>6}{ph:>6}x{h:>7.2f}%/{s:>5.2f}%{cells}")
        rows.append((h, s))
    if rows:
        print(f"\nphrase hits% observed range: {min(r[0] for r in rows):.2f}% – "
              f"{max(r[0] for r in rows):.2f}%")
        print("Target the phrase by OCCURRENCE COUNT inside this range; read any "
              "'2%' brief as the single token, never the multi-word phrase.")
    # competitor FAQ questions double as SERP evidence
    print("\n--- questions these ranking pages actually use ---")
    for u in urls:
        try:
            html = fetch(u)
        except Exception:
            continue
        qs = set(re.findall(r'"@type"\s*:\s*"Question"\s*,\s*"name"\s*:\s*"([^"]{10,200})"', html))
        for m in re.finditer(r"<(h[2-4]|summary)[^>]*>(.*?)</\1>", html, re.S):
            t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2))).strip()
            if t.endswith("?") and 10 < len(t) < 200:
                qs.add(t)
        if qs:
            print(f"\n  {u}")
            for q in sorted(qs):
                print("    ·", q)
    return 0


# ------------------------------------------------------------- autocomplete

def suggest(seeds, hl="en", gl="us"):
    seen, out = set(), {}
    for s in seeds:
        bag = set()
        for pre in QUESTION_PREFIXES:
            q = pre + s
            url = ("https://suggestqueries.google.com/complete/search"
                   f"?client=firefox&hl={hl}&gl={gl}&q={urllib.parse.quote(q)}")
            try:
                data = json.loads(fetch(url, timeout=8))[1]
            except Exception:
                data = []
            for r in data:
                r = r.strip()
                if r and r not in seen:
                    bag.add(r)
                    seen.add(r)
            time.sleep(0.12)
        out[s] = sorted(bag)
    total = 0
    for s, v in out.items():
        if not v:
            continue
        print(f"\n########## {s}  ({len(v)})")
        for x in v:
            print("  ·", x)
            total += 1
    print(f"\n>>> {total} real Google suggestions across {len(seeds)} seeds")
    print("Filter homophone noise before use, then write FAQ questions in the "
          "user's exact wording rather than paraphrasing them.")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--targets", help="path to targets.json")
    ap.add_argument("--benchmark", nargs="+", metavar="URL",
                    help="competitor URLs to measure")
    ap.add_argument("--phrase", help="head phrase, with --benchmark")
    ap.add_argument("--token", nargs="+", default=[], help="single tokens, with --benchmark")
    ap.add_argument("--suggest", nargs="+", metavar="SEED",
                    help="seed keywords for Google autocomplete")
    ap.add_argument("--hl", default="en")
    ap.add_argument("--gl", default="us")
    a = ap.parse_args()

    if a.targets:
        return audit(json.loads(Path(a.targets).read_text(encoding="utf-8")))
    if a.benchmark:
        if not a.phrase:
            ap.error("--benchmark requires --phrase")
        return benchmark(a.benchmark, a.phrase, a.token)
    if a.suggest:
        return suggest(a.suggest, a.hl, a.gl)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
