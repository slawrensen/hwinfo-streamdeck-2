// Generates the docs-site Changelog page from the root CHANGELOG.md so the two
// never drift. GitHub Pages' Jekyll build cannot include a file from outside
// docs/, so this writes a committed docs/changelog.md. Regenerate whenever
// CHANGELOG.md changes (it is part of the release runbook).
//   node scripts/gen-changelog-page.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");

// Drop the root file's own "# Changelog" H1 (the page title supplies it) and
// keep the rest verbatim, entries and all.
const body = src.replace(/^#\s+Changelog\s*\n+/, "").trimEnd();

const page = `---
title: Changelog
nav_order: 12
---

# Changelog

Every version below matches a
[GitHub release](https://github.com/slawrensen/hwinfo-streamdeck/releases/latest)
with a downloadable \`.streamDeckPlugin\`. Generated from the repo's
\`CHANGELOG.md\`; do not edit this page by hand.

${body}
`;

const out = path.join(root, "docs", "changelog.md");
writeFileSync(out, page);
console.log(`wrote ${path.relative(root, out)} from CHANGELOG.md`);
