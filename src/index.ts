#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  parseFigmaUrl,
  fetchNodeTree,
  collectIconNodes,
  exportSVGUrls,
  fetchSVGContent,
} from "./figma.js";
import { toPascalCase, extractSVGInternals, extractPaths, generateTSX } from "./svg-utils.js";
import { loadExistingIcons, findSimilarIcon, writeIconFile } from "./icon-matcher.js";

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
if (!FIGMA_TOKEN) {
  console.error("❌ FIGMA_TOKEN environment variable is not set.");
  process.exit(1);
}

const server = new McpServer({ name: "figma-icon-mcp", version: "2.0.0" });

// ── extract_icons_from_figma ─────────────────────────────────────────────────
server.registerTool(
  "extract_icons_from_figma",
  {
    description:
      "Extract all SVG icons from a Figma node URL and save new ones as TSX components. " +
      "Uses the Figma REST API directly — handles deep/nested nodes including instances. " +
      "Checks existing icons folder and skips duplicates. " +
      "Parameter is figma_url (not figma_node_url).",
    inputSchema: {
      figma_url: z.string().describe(
        "Figma node URL. MUST use parameter name 'figma_url'. e.g. https://www.figma.com/design/xxx/Name?node-id=21551-57647"
      ),
      icons_dir: z.string().describe(
        "Absolute path to your icons folder e.g. /Users/you/project/src/components/icons"
      ),
      dry_run: z.boolean().optional().describe(
        "Preview results without writing files. Default: false."
      ),
      copy_existing: z.boolean().optional().describe(
        "Write similar/duplicate icons with a -copy suffix instead of skipping. Default: false."
      ),
    },
  },
  async ({ figma_url, icons_dir, dry_run = false, copy_existing = false }) => {
    try {
      // 1. Parse URL
      const { fileKey, nodeId } = parseFigmaUrl(figma_url);
      if (!nodeId) {
        return {
          content: [{
            type: "text" as const,
            text: "❌ No node-id found in URL. Please use a URL with ?node-id=XXXXX-YYYYY",
          }],
        };
      }

      // 2. Fetch full node tree via REST API (deep — includes all instance children)
      const root = await fetchNodeTree(FIGMA_TOKEN!, fileKey, nodeId);

      // 3. Walk tree and collect icon nodes
      const iconNodes = collectIconNodes(root);

      if (iconNodes.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: [
              "## No icon nodes found",
              "",
              `Searched inside node \`${nodeId}\` (${root.name}).`,
              "",
              "Icon detection looks for nodes where:",
              "- Type is INSTANCE, COMPONENT, VECTOR, or BOOLEAN_OPERATION",
              "- Name matches kebab-case pattern: `wallet-03`, `arrow-right`, `x-close`",
              "- Width equals height (square) and size is in: 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64px",
              "",
              "Try pointing to a dedicated icon frame/page node.",
            ].join("\n"),
          }],
        };
      }

      // 4. Export all SVGs in one batched request
      const nodeIds = iconNodes.map((n) => n.id);
      const svgUrlMap = await exportSVGUrls(FIGMA_TOKEN!, fileKey, nodeIds);

      // 5. Download SVG content in parallel
      const svgContentMap: Record<string, string> = {};
      await Promise.all(
        Object.entries(svgUrlMap).map(async ([id, url]) => {
          if (!url) return;
          try {
            svgContentMap[id] = await fetchSVGContent(url);
          } catch {
            // skip failed SVG fetches
          }
        })
      );

      // 6. Process each icon
      const existingIcons = loadExistingIcons(icons_dir);
      const results: Array<{
        figmaName: string;
        componentName: string;
        status: "created" | "skipped" | "dry_run";
        reason?: string;
        existingFile?: string;
        filePath?: string;
        tsxPreview?: string;
      }> = [];

      for (const node of iconNodes) {
        const svgRaw = svgContentMap[node.id];
        const componentName = toIconName(node.name);

        if (!svgRaw) {
          results.push({
            figmaName: node.name,
            componentName,
            status: "skipped",
            reason: "SVG export failed or returned null",
          });
          continue;
        }

        const newPaths = extractPaths(svgRaw);
        const match = findSimilarIcon(componentName, newPaths, existingIcons);

        if (!match.isNew) {
          if (copy_existing) {
            const copyName = componentName.replace(/Icon$/, "CopyIcon");
            const { viewBox, innerContent } = extractSVGInternals(svgRaw);
            const tsx = generateTSX(copyName, viewBox, innerContent);
            if (dry_run) {
              results.push({ figmaName: node.name, componentName: copyName, status: "dry_run", tsxPreview: tsx });
            } else {
              results.push({ figmaName: node.name, componentName: copyName, status: "created", filePath: writeIconFile(icons_dir, copyName, tsx) });
            }
          } else {
            results.push({
              figmaName: node.name,
              componentName,
              status: "skipped",
              existingFile: `${match.matchedIcon!.name}.tsx`,
              reason: `Already exists as \`${match.matchedIcon!.name}.tsx\` (${match.matchType}, ${match.similarity}% match)`,
            });
          }
          continue;
        }

        const { viewBox, innerContent } = extractSVGInternals(svgRaw);
        const tsx = generateTSX(componentName, viewBox, innerContent);

        if (dry_run) {
          results.push({ figmaName: node.name, componentName, status: "dry_run", tsxPreview: tsx });
        } else {
          results.push({ figmaName: node.name, componentName, status: "created", filePath: writeIconFile(icons_dir, componentName, tsx) });
        }
      }

      // 7. Build summary
      const created = results.filter((r) => r.status === "created" || r.status === "dry_run");
      const skipped = results.filter((r) => r.status === "skipped");
      const alreadyExist = skipped.filter((r) => r.existingFile);
      const exportFailed = skipped.filter((r) => !r.existingFile);

      let summary = `## Icon Extraction Complete\n\n`;
      summary += `| | |\n|---|---|\n`;
      summary += `| **Node scanned** | \`${nodeId}\` — ${root.name} |\n`;
      summary += `| **Total icons found** | ${iconNodes.length} |\n`;
      summary += `| **${dry_run ? "Would create" : "Created"}** | ${created.length} |\n`;
      summary += `| **Already existed** | ${alreadyExist.length} |\n`;
      summary += `| **SVG export failed** | ${exportFailed.length} |\n\n`;

      if (created.length > 0) {
        summary += `### ✅ ${dry_run ? "Would Create" : "Created"} (${created.length})\n`;
        for (const r of created) {
          summary += `- \`${r.componentName}.tsx\`  ←  Figma: "${r.figmaName}"`;
          if (r.filePath) summary += `\n  📁 \`${r.filePath}\``;
          summary += "\n";
          if (dry_run && r.tsxPreview) summary += `\n\`\`\`tsx\n${r.tsxPreview}\n\`\`\`\n`;
        }
        summary += "\n";
      }

      if (alreadyExist.length > 0) {
        summary += `### ⏭️ Already Exist — Skipped (${alreadyExist.length})\n`;
        for (const r of alreadyExist) {
          summary += `- \`${r.figmaName}\`  →  \`${r.existingFile}\`  (${r.reason?.match(/\d+%/)?.[0] ?? ""} similar)\n`;
        }
        summary += "\n";
      }

      if (exportFailed.length > 0) {
        summary += `### ❌ SVG Export Failed (${exportFailed.length})\n`;
        summary += `These icons were found in Figma but their SVG could not be exported (Figma returned null — usually means the node is invisible, has 0% opacity, or is a non-renderable component):\n`;
        for (const r of exportFailed) {
          summary += `- \`${r.figmaName}\` (node rendered null by Figma API)\n`;
        }
        summary += "\n";
      }

      return { content: [{ type: "text" as const, text: summary }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ Error: ${err.message}` }] };
    }
  }
);

// ── svg_to_icon ──────────────────────────────────────────────────────────────
server.registerTool(
  "svg_to_icon",
  {
    description: "Convert raw SVG code into a TSX icon component and optionally write it to your icons folder.",
    inputSchema: {
      svg_code: z.string().describe("Raw SVG markup string."),
      icon_name: z.string().describe("Icon name e.g. 'arrow-right' → ArrowRightIcon."),
      icons_dir: z.string().optional().describe("If provided, writes the TSX file after similarity check."),
      dry_run: z.boolean().optional().describe("Only return TSX, don't write file."),
    },
  },
  async ({ svg_code, icon_name, icons_dir, dry_run = false }) => {
    try {
      const componentName = toIconName(icon_name);
      const { viewBox, innerContent } = extractSVGInternals(svg_code);
      const tsx = generateTSX(componentName, viewBox, innerContent);
      let result = `## Generated: \`${componentName}.tsx\`\n\n\`\`\`tsx\n${tsx}\n\`\`\`\n`;
      if (icons_dir && !dry_run) {
        const match = findSimilarIcon(componentName, extractPaths(svg_code), loadExistingIcons(icons_dir));
        if (!match.isNew) {
          result += `\n⚠️ Similar exists: \`${match.matchedIcon!.name}.tsx\` (${match.matchType}, ${match.similarity}%). Not written.\n`;
        } else {
          result += `\n✅ Written to: \`${writeIconFile(icons_dir, componentName, tsx)}\`\n`;
        }
      }
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ Error: ${err.message}` }] };
    }
  }
);

function toIconName(name: string): string {
  const pascal = toPascalCase(name.replace(/\s+/g, "-"));
  return pascal.endsWith("Icon") ? pascal : `${pascal}Icon`;
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("figma-icon-mcp v2 running on stdio");