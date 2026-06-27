import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve("src");

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await files(fullPath));
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      result.push(fullPath);
    }
  }
  return result;
}

const sourceFiles = await files(root);
const contents = await Promise.all(
  sourceFiles.map(async (file) => [file, await readFile(file, "utf8")])
);

for (const [file, content] of contents) {
  assert.equal(
    content.includes("ufdsGrouping"),
    false,
    `No debe importarse ni consumirse ufdsGrouping en ${file}`
  );
  assert.equal(
    /class\s+UnionFind|function\s+UnionFind/.test(content),
    false,
    `No debe existir una implementacion UnionFind activa en ${file}`
  );
  assert.equal(
    /buildGroupedZonesWithUfds/.test(content),
    false,
    `No debe recalcularse agrupacion UFDS en JavaScript en ${file}`
  );
}
