#!/usr/bin/env python3
"""
bump_versions.py — auto cache-bust changed asset files for the tour site.

What it does:
  1. Hashes every asset file that's referenced with a "?v=" cache-busting
     query string in index.html / tour.xml.
  2. Compares each hash against the one recorded the last time this script
     ran (stored in versions.json, created automatically on first run).
  3. For any file whose bytes changed, bumps every "filename?v=OLDVER"
     reference to it (inside index.html and/or tour.xml) to a fresh
     timestamp version, e.g. "filename?v=202609221530".
  4. Cascades correctly: output_hotspots.xml / landmarks.xml are
     <include>d by tour.xml. If either changes, this script bumps that
     include line's own version first -- which changes tour.xml's own
     bytes -- which this script then detects and uses to bump tour.xml's
     own reference in index.html's embedpano({ xml: "tour.xml?v=..." })
     call too. Skipping that last step is exactly what causes a visitor's
     browser to keep serving a cached tour.xml that still points at the
     old, now-stale hotspot/landmark file.

Usage:
    python bump_versions.py

Run this from the same local folder as index.html and tour.xml (i.e. your
working copy of the repo), after saving your edits and before you commit
and push/deploy.

First run note: versions.json won't exist yet, so every tracked file will
look "changed" and get a version bump the first time you run this -- that's
expected and harmless (it just cache-busts everything once). From the
second run onward, only files you actually edited get bumped.
"""

import hashlib
import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = ROOT / "versions.json"

# Plain CSS/JS assets -- referenced only from index.html.
# Edit this list if you add/rename/remove a <script>/<link> file.
LEAF_ASSETS = [
    "plot-popup.css",
    "plot-popup-mobile.css",
    "filter-panel.css",
    "action-bar.css",
    "enquiry-popup.css",
    "plot-compare.css",
    "tour.js",
    "plot-popup-mobile.js",
    "plot-popup.js",
    "plot-compare.js",
    "filter-panel.js",
    "enquiry-popup.js",
    "action-bar.js",
    "brand-logo.js",
    "road-label-zoom.js",
]

# XML files <include>d from inside tour.xml.
INCLUDED_XML = [
    "output_hotspots.xml",
    "landmarks.xml",
]

TOUR_XML = "tour.xml"      # both an asset (ref'd from index.html) AND a referencing file
INDEX_HTML = "index.html"  # a referencing file only -- nothing references index.html itself

# Files whose text we search for "name?v=version" strings and rewrite.
REFERENCING_FILES = [INDEX_HTML, TOUR_XML]

VERSION_RE_TEMPLATE = r"({name}\?v=)([A-Za-z0-9_.\-]+)"


def new_version() -> str:
    return time.strftime("%Y%m%d%H%M")


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_manifest() -> dict:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {}


def save_manifest(manifest: dict) -> None:
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8"
    )


def bump_reference(fname: str, version: str) -> None:
    """Rewrite every 'fname?v=OLD' occurrence, in every referencing file,
    to 'fname?v=version'."""
    pattern = re.compile(VERSION_RE_TEMPLATE.format(name=re.escape(fname)))
    for rf_name in REFERENCING_FILES:
        rf_path = ROOT / rf_name
        if not rf_path.exists():
            continue
        text = rf_path.read_text(encoding="utf-8")
        new_text, count = pattern.subn(r"\g<1>" + version, text)
        if count and new_text != text:
            rf_path.write_text(new_text, encoding="utf-8")
            print(f"  bumped {fname} -> ?v={version}  (in {rf_name})")


def process_asset(fname: str, manifest: dict, version: str) -> bool:
    """Check one asset file for changes; bump its references if needed.
    Returns True if its bytes changed since the last recorded hash."""
    path = ROOT / fname
    if not path.exists():
        print(f"  ! {fname} is referenced but not found on disk -- skipped")
        return False
    h = file_hash(path)
    if manifest.get(fname) == h:
        return False  # unchanged since last run
    print(f"changed: {fname}")
    bump_reference(fname, version)
    manifest[fname] = h
    return True


def main() -> None:
    manifest = load_manifest()
    version = new_version()

    # 1) Leaf CSS/JS + included XML -- check & bump first.
    tour_needs_bump = False
    for fname in LEAF_ASSETS:
        process_asset(fname, manifest, version)
    for fname in INCLUDED_XML:
        if process_asset(fname, manifest, version):
            tour_needs_bump = True  # tour.xml's own bytes are about to change

    # 2) tour.xml itself -- re-checked AFTER any include bumps above, since
    #    those edits change tour.xml's own bytes and must cascade into
    #    index.html's embedpano({ xml: "tour.xml?v=..." }) reference.
    tour_path = ROOT / TOUR_XML
    if tour_path.exists():
        h = file_hash(tour_path)
        if tour_needs_bump or manifest.get(TOUR_XML) != h:
            print(f"changed: {TOUR_XML}")
            bump_reference(TOUR_XML, version)
            manifest[TOUR_XML] = file_hash(tour_path)  # re-hash AFTER the bump edit
        else:
            manifest[TOUR_XML] = h
    else:
        print(f"  ! {TOUR_XML} not found on disk -- skipped")

    save_manifest(manifest)
    print("\nDone. Review the diff, then commit/push index.html, tour.xml, "
          "any changed assets, and versions.json.")


if __name__ == "__main__":
    main()
