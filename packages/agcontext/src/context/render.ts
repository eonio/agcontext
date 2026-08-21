import type { ContextFormat } from "../config/schema.js";
import { extensionOf } from "../core/paths.js";
import type { ContextPackage } from "../core/types.js";

/**
 * Deterministic renderers for the assembled context (phase 11). Markdown for
 * humans and most agents; XML for models that respond well to tagged context
 * (e.g. Claude); JSON for programmatic consumers.
 */
export function renderContext(pkg: ContextPackage, format: ContextFormat): string {
  switch (format) {
    case "markdown":
      return renderMarkdown(pkg);
    case "xml":
      return renderXml(pkg);
    case "json":
      return renderJson(pkg);
  }
}

export function renderMarkdown(pkg: ContextPackage): string {
  const out: string[] = ["# Repository Context", "", pkg.summary, ""];

  if (pkg.architecture.length > 0) {
    out.push("## Architecture", "");
    for (const line of pkg.architecture) out.push(`- ${line}`);
    out.push("");
  }

  if (pkg.files.length > 0) {
    out.push("## Files", "");
    for (const file of pkg.files) {
      out.push(`### ${file.path}`, "", `> ${file.reason} — ${file.representation} view`, "");
      if (file.representation === "mention") {
        out.push(file.content, "");
      } else {
        out.push(`\`\`\`${fenceLanguage(file.path)}`, file.content, "```", "");
      }
    }
  }

  if (pkg.symbols.length > 0) {
    out.push("## Symbols", "");
    for (const symbol of pkg.symbols) {
      const lines =
        symbol.startLine !== undefined
          ? `:${symbol.startLine}-${symbol.endLine ?? symbol.startLine}`
          : "";
      out.push(`### ${symbol.name} (${symbol.kind}) — ${symbol.file}${lines}`, "");
      if (symbol.doc) out.push(symbol.doc, "");
      out.push("```ts", symbol.code ?? symbol.signature, "```", "");
      for (const relation of symbol.relations) out.push(`- ${relation}`);
      if (symbol.relations.length > 0) out.push("");
    }
  }

  if (pkg.recommendations.length > 0) {
    out.push("## Recommendations", "");
    pkg.recommendations.forEach((recommendation, i) => {
      out.push(`${i + 1}. ${recommendation}`);
    });
    out.push("");
  }

  out.push(
    `<!-- agcontext: ${pkg.tokens.used}/${pkg.tokens.budget} tokens, strategy=${pkg.meta.strategy}, nodes=${pkg.meta.nodeCount} -->`,
  );
  return out.join("\n");
}

export function renderXml(pkg: ContextPackage): string {
  const out: string[] = [];
  out.push(
    `<context query=${attr(pkg.meta.query)} strategy=${attr(pkg.meta.strategy)} tokens=${attr(`${pkg.tokens.used}/${pkg.tokens.budget}`)}>`,
  );
  out.push(`  <summary>${escapeXml(pkg.summary)}</summary>`);
  if (pkg.architecture.length > 0) {
    out.push("  <architecture>");
    for (const line of pkg.architecture) out.push(`    <item>${escapeXml(line)}</item>`);
    out.push("  </architecture>");
  }
  if (pkg.files.length > 0) {
    out.push("  <files>");
    for (const file of pkg.files) {
      out.push(
        `    <file path=${attr(file.path)} representation=${attr(file.representation)} tokens=${attr(String(file.tokens))} reason=${attr(file.reason)}>`,
      );
      out.push(cdata(file.content, "      "));
      out.push("    </file>");
    }
    out.push("  </files>");
  }
  if (pkg.symbols.length > 0) {
    out.push("  <symbols>");
    for (const symbol of pkg.symbols) {
      const range =
        symbol.startLine !== undefined
          ? ` lines=${attr(`${symbol.startLine}-${symbol.endLine ?? symbol.startLine}`)}`
          : "";
      out.push(
        `    <symbol name=${attr(symbol.name)} kind=${attr(symbol.kind)} file=${attr(symbol.file)}${range}>`,
      );
      out.push(`      <signature>${escapeXml(symbol.signature)}</signature>`);
      if (symbol.doc) out.push(`      <doc>${escapeXml(symbol.doc)}</doc>`);
      for (const relation of symbol.relations) {
        out.push(`      <relation>${escapeXml(relation)}</relation>`);
      }
      if (symbol.code !== undefined) {
        out.push("      <code>");
        out.push(cdata(symbol.code, "        "));
        out.push("      </code>");
      }
      out.push("    </symbol>");
    }
    out.push("  </symbols>");
  }
  if (pkg.recommendations.length > 0) {
    out.push("  <recommendations>");
    for (const recommendation of pkg.recommendations) {
      out.push(`    <item>${escapeXml(recommendation)}</item>`);
    }
    out.push("  </recommendations>");
  }
  out.push("</context>");
  return out.join("\n");
}

export function renderJson(pkg: ContextPackage): string {
  return JSON.stringify(pkg, null, 2);
}

const FENCE_LANGUAGES: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".mts": "ts",
  ".cts": "ts",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".cjs": "js",
};

function fenceLanguage(path: string): string {
  return FENCE_LANGUAGES[extensionOf(path)] ?? "";
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function attr(value: string): string {
  return `"${escapeXml(value)}"`;
}

function cdata(text: string, indent: string): string {
  const safe = text.replaceAll("]]>", "]]]]><![CDATA[>");
  return `${indent}<![CDATA[${safe}]]>`;
}
