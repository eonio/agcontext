/**
 * A complete AGContext plugin combining two capabilities:
 *
 * - RankingPlugin: a custom "hotPath" signal boosting files under
 *   directories your team currently cares about.
 * - CompressionPlugin: annotates compressed file summaries with the
 *   matched focus area, so agents see the tag too.
 *
 * Load it from config:  plugins: ["./hot-files-plugin.mjs"]
 * or programmatically:  new AGContext().use(plugin)
 */

const FOCUS_AREAS = [
  { prefix: "src/auth/", label: "Q3 security review" },
  { prefix: "src/billing/", label: "billing rewrite" },
];

function focusFor(path) {
  return FOCUS_AREAS.find((area) => path.startsWith(area.prefix));
}

/** @type {import("@eonio/agcontext").AGContextPlugin} */
const plugin = {
  name: "hot-files",
  version: "1.0.0",

  ranking: {
    signals: [
      {
        name: "hotPath",
        weight: 0.12,
        compute(nodeId, { graph }) {
          const node = graph.node(nodeId);
          const path = node?.path ?? node?.file;
          if (path === undefined) return undefined;
          return focusFor(path) ? 1 : 0;
        },
      },
    ],
  },

  compression: {
    fileSummarizer: {
      summarize(analysis, defaultSummary) {
        const focus = focusFor(analysis.path);
        return focus ? `// FOCUS AREA: ${focus.label}\n${defaultSummary}` : defaultSummary;
      },
    },
  },

  hooks: {
    afterIndex({ stats }) {
      console.error(`[hot-files] index refreshed: ${stats.files} files`);
    },
  },
};

export default plugin;
