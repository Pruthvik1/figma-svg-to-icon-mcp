import axios from "axios";

const FIGMA_BASE = "https://api.figma.com/v1";

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { width: number; height: number };
}

export function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } {
  const keyMatch = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  if (!keyMatch) return { fileKey: input };
  const fileKey = keyMatch[1];
  const nodeMatch = input.match(/node-id=([^&]+)/);
  const nodeId = nodeMatch ? decodeURIComponent(nodeMatch[1]).replace("-", ":") : undefined;
  return { fileKey, nodeId };
}

/** Fetch node subtree with full geometry — resolves instance children */
export async function fetchNodeTree(
  token: string,
  fileKey: string,
  nodeId: string
): Promise<FigmaNode> {
  const res = await axios.get(`${FIGMA_BASE}/files/${fileKey}/nodes`, {
    headers: { "X-Figma-Token": token },
    params: {
      ids: nodeId,
      geometry: "paths", // includes vector path data
    },
  });
  const nodeData = res.data.nodes[nodeId];
  if (!nodeData) throw new Error(`Node ${nodeId} not found`);
  return nodeData.document as FigmaNode;
}

const ICON_SIZES = new Set([12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64]);
const ICON_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const EXCLUDE_NAMES = new Set([
  "solid", "bold", "regular", "light", "thin", "duotone", "outline",
  "featured-icon", "icon-wrapper", "container",
]);

function isIconName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  if (EXCLUDE_NAMES.has(lower)) return false;
  if (/^(frame|group|layer|rectangle|ellipse|vector|line)\s*\d*$/i.test(lower)) return false;
  return ICON_NAME_PATTERN.test(lower);
}

function isIconSize(node: FigmaNode): boolean {
  const bbox = node.absoluteBoundingBox;
  if (!bbox) return false;
  return Math.abs(bbox.width - bbox.height) <= 1 && ICON_SIZES.has(Math.round(bbox.width));
}

/**
 * Walk the full node tree recursively (REST API returns complete tree including
 * all instance children — unlike Dev Mode MCP which is shallow).
 * Collect icon nodes: INSTANCE/COMPONENT that are icon-sized with kebab names.
 * Deduplicate by name.
 */
export function collectIconNodes(root: FigmaNode): FigmaNode[] {
  const icons: FigmaNode[] = [];
  const seenNames = new Set<string>();

  function walk(node: FigmaNode) {
    const type = node.type;
    const isIconType = ["INSTANCE", "COMPONENT", "VECTOR", "BOOLEAN_OPERATION"].includes(type);

    if (isIconType && isIconSize(node) && isIconName(node.name)) {
      const key = node.name.toLowerCase().trim();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        icons.push(node);
        return; // don't recurse into icon internals
      }
      return;
    }

    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }

  walk(root);
  return icons;
}

/** Batch export SVGs for node IDs — returns map of nodeId → SVG URL */
export async function exportSVGUrls(
  token: string,
  fileKey: string,
  nodeIds: string[]
): Promise<Record<string, string>> {
  const chunks: string[][] = [];
  for (let i = 0; i < nodeIds.length; i += 100) {
    chunks.push(nodeIds.slice(i, i + 100));
  }

  const result: Record<string, string> = {};
  for (const chunk of chunks) {
    const res = await axios.get(`${FIGMA_BASE}/images/${fileKey}`, {
      headers: { "X-Figma-Token": token },
      params: {
        ids: chunk.join(","),
        format: "svg",
        svg_include_id: false,
        svg_simplify_stroke: true,
      },
    });
    Object.assign(result, res.data.images);
  }
  return result;
}

/** Download SVG content from a URL */
export async function fetchSVGContent(url: string): Promise<string> {
  const res = await axios.get(url, { responseType: "text" });
  return res.data as string;
}