/**
 * Basic AGContext usage: index a repository, run hybrid retrieval, and
 * print an assembled context package.
 *
 *   node examples/basic/main.mjs /path/to/repo "how does authentication work"
 */
import { AGContext, renderMarkdown } from "@eonio/agcontext";

const [root = process.cwd(), query = "How does authentication work?"] = process.argv.slice(2);

const agc = new AGContext({
  cwd: root,
  // Everything below is optional — shown for visibility:
  strategy: "hybrid",
  graphDepth: 2,
  logLevel: "info",
});

// 1. Build (or incrementally update) the index.
const stats = await agc.index();
console.log(
  `indexed ${stats.files} files → ${stats.nodes} nodes, ${stats.edges} edges in ${stats.durationMs}ms`,
);

// 2. Ranked retrieval with per-signal transparency.
const retrieval = await agc.retrieve({ query, limit: 10 });
for (const item of retrieval.items) {
  const signals = Object.entries(item.signals)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v.toFixed(2)}`)
    .join(" ");
  console.log(
    `${item.score.toFixed(3)}  ${item.kind.padEnd(9)} ${item.name.padEnd(24)} ${item.path}  [${signals}]`,
  );
}
console.log(`(${Math.round(retrieval.diagnostics.totalMs)}ms total)`);

// 3. The full token-budgeted context package, rendered for an agent prompt.
const pkg = await agc.context({ query, maxTokens: 6000 });
console.log("\n----- context package -----\n");
console.log(renderMarkdown(pkg));
