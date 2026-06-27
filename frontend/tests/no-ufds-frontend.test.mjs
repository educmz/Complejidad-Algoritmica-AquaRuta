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
  assert.equal(
    content.includes("tspMemoization"),
    false,
    `No debe importarse ni consumirse tspMemoization en ${file}`
  );
  assert.equal(
    /solveTspMemoization|function\s+dp\s*\(|bitmask|mask\s*&|1\s*<<\s*n/.test(content),
    false,
    `No debe existir una implementacion TSP-DP activa en ${file}`
  );
  assert.equal(
    /scaleRoute|distance\s*\*\s*1\.25|distance\s*\*\s*1\.4|newDistance\s*=\s*currentDistance/.test(content),
    false,
    `No debe existir una implementacion Dijkstra o escalado de pesos en React en ${file}`
  );
  assert.equal(
    /function\s+bfs\s*\(|function\s+dfs\s*\(|breadthFirst|depthFirst|queue\.shift\s*\(|stack\.pop\s*\(\)/.test(content),
    false,
    `No debe existir una implementacion BFS/DFS activa en React en ${file}`
  );
}
