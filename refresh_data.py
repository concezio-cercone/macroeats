#!/usr/bin/env python3
"""
refresh_data.py — update the OpenNutrition-derived data to the latest release.

OpenNutrition has no live API; it ships as a versioned ZIP. This finds the
latest release, downloads + checksums it, re-extracts the restaurant subset, and
rebuilds data/opennutrition-chains.json — the "keep it updated every once in a
while" path. Run it by hand occasionally, or from a scheduler.

  python refresh_data.py                      # find & fetch latest, rebuild
  python refresh_data.py --version 2025.1      # pin a version
  python refresh_data.py --source foods.tsv    # rebuild from a local dump (no download)

The data is OpenNutrition's, under ODbL — see NOTICE.md. The big dump is NOT
committed (the refresh re-creates the working subset); only the compact derived
JSON the app loads is kept in git.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "opennutrition-chains.json")
DL_PAGE = "https://www.opennutrition.app/download"
DL_BASE = "https://downloads.opennutrition.app/opennutrition-dataset-%s.zip"
KNOWN_VERSION = "2025.1"   # fallback if the download page can't be parsed
UA = {"User-Agent": "MacroEats-refresh/0.1 (personal project)"}


def http_get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120)


def find_latest():
    """Scrape the download page for the newest dataset URL + (optional) sha256."""
    try:
        html = http_get(DL_PAGE).read().decode("utf-8", "replace")
        m = re.search(r"https://downloads\.opennutrition\.app/opennutrition-dataset-([0-9.]+)\.zip", html)
        if m:
            sha = None
            sm = re.search(r"\b([a-f0-9]{64})\b", html)
            if sm:
                sha = sm.group(1)
            return m.group(0), m.group(1), sha
    except Exception as e:
        print("  (couldn't read download page: %s)" % e)
    return DL_BASE % KNOWN_VERSION, KNOWN_VERSION, None


def counts():
    try:
        d = json.load(open(OUT, encoding="utf-8"))
        return d.get("chainCount"), d.get("itemCount")
    except Exception:
        return (None, None)


def run_build(tsv):
    env = dict(os.environ, OPENNUTRITION_TSV=os.path.abspath(tsv))
    print("Rebuilding from %s ..." % tsv)
    subprocess.run([sys.executable, os.path.join(HERE, "build_opennutrition.py")],
                   env=env, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", help="pin a dataset version, e.g. 2025.1")
    ap.add_argument("--source", help="rebuild from a local full-dataset TSV (skip download)")
    args = ap.parse_args()

    before = counts()

    if args.source:
        if not os.path.exists(args.source):
            sys.exit("source not found: " + args.source)
        run_build(args.source)
    else:
        if args.version:
            url, ver, sha = DL_BASE % args.version, args.version, None
        else:
            url, ver, sha = find_latest()
        print("Latest OpenNutrition dataset: %s" % ver)
        print("Downloading %s ..." % url)
        with tempfile.TemporaryDirectory() as tmp:
            with http_get(url) as r:
                data = r.read()
            digest = hashlib.sha256(data).hexdigest()
            print("  %.1f MB   sha256=%s" % (len(data) / 1e6, digest))
            if sha:
                if digest == sha:
                    print("  checksum matches the download page ✓")
                else:
                    sys.exit("  checksum MISMATCH (page says %s) — aborting" % sha)
            else:
                print("  (no published checksum found to compare - verify manually if needed)")
            zp = os.path.join(tmp, "ds.zip")
            with open(zp, "wb") as f:
                f.write(data)
            with zipfile.ZipFile(zp) as z:
                name = next((n for n in z.namelist() if n.endswith("_foods.tsv")),
                            next((n for n in z.namelist() if n.endswith(".tsv")), None))
                if not name:
                    sys.exit("no .tsv found in the archive")
                z.extract(name, tmp)
                run_build(os.path.join(tmp, name))

    after = counts()
    print("\nopennutrition-chains.json: %s -> %s chains, %s -> %s items" %
          (before[0], after[0], before[1], after[1]))
    print("Done. (ODbL data - attribution required; see NOTICE.md)")


if __name__ == "__main__":
    main()
