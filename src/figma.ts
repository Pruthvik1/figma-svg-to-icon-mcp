import axios from "axios";

const FIGMA_BASE = "https://api.figma.com/v1";

/**
 * Retry wrapper with exponential backoff.
 * Figma rate limits: 429 → wait and retry. Other errors → throw immediately.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 4,
  delayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status;
      const isLast = attempt === retries;

      if (status === 429 && !isLast) {
        // Respect Retry-After header if present, otherwise exponential backoff
        const retryAfter = err.response?.headers?.["retry-after"];
        const wait = retryAfter ? parseInt(retryAfter) * 1000 : delayMs * 2 ** (attempt - 1);
        console.error(`Figma API rate limited (429). Retrying in ${wait / 1000}s... (attempt ${attempt}/${retries})`);
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }

      // 5xx server errors — also retry
      if (status >= 500 && status < 600 && !isLast) {
        const wait = delayMs * 2 ** (attempt - 1);
        console.error(`Figma API error ${status}. Retrying in ${wait / 1000}s... (attempt ${attempt}/${retries})`);
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }

      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { width: number; height: number };
}

// ✅ #1 — fix regex for /proto/ URLs, fix /-/g to replace ALL dashes not just first
export function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } {
  const keyMatch = input.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)/);
  if (!keyMatch) return { fileKey: input };
  const fileKey = keyMatch[1];
  const nodeMatch = input.match(/node-id=([^&]+)/);
  const nodeId = nodeMatch
    ? decodeURIComponent(nodeMatch[1]).replace(/-/g, ":")  // /-/g not just first "-"
    : undefined;
  return { fileKey, nodeId };
}

/**
 * Converts any Figma layer name to a valid PascalCase React component name.
 * Handles: slash-separated "icons/arrow/right", kebab "arrow-right",
 *          snake "arrow_right", spaces "Arrow Right", PascalCase "ArrowRight"
 * ✅ #6 — added, fixed to preserve mid-word casing properly
 */
export function toComponentName(rawName: string): string {
  // Split on slashes, dashes, underscores, spaces, and camelCase boundaries
  const words = rawName
    .replace(/\//g, " ")
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase → words
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // PascalCase each word — preserve existing uppercase (don't lowercase whole word)
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** Fetch node subtree with full geometry — resolves instance children */
export async function fetchNodeTree(
  token: string,
  fileKey: string,
  nodeId: string
): Promise<FigmaNode> {
  const res = await withRetry(() =>
    axios.get(`${FIGMA_BASE}/files/${fileKey}/nodes`, {
      headers: { "X-Figma-Token": token },
      params: { ids: nodeId, geometry: "paths" },
    })
  );
  const nodeData = res.data.nodes[nodeId];
  if (!nodeData) throw new Error(`Node ${nodeId} not found`);
  return nodeData.document as FigmaNode;
}

const EXCLUDE_NAMES = new Set([
  "solid", "bold", "regular", "light", "thin", "duotone", "outline",
  "featured-icon", "icon-wrapper", "container", "background",
  "background pattern decorative", "placeholder image",
]);

function isIconName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  if (EXCLUDE_NAMES.has(lower)) return false;
  if (/^(frame|group|component|instance|vector|union|rectangle|ellipse|line|polygon|star|image|mask|content|layout|divider|spacer|wrapper)\s*\d*$/i.test(lower)) return false;
  if (lower.split(/[\s/]+/).length > 3) return false;
  if (!lower || /^\d+$/.test(lower)) return false;
  if (/^(button|tab|modal|header|footer|nav|toolbar|dialog|tooltip|badge|chip|card|avatar)\b/i.test(lower)) return false;
  return true;
}

/**
 * Size check — does NOT require square.
 * Many real icons are non-square: hamburger (24×18), logos, custom glyphs.
 * Only requirement: both dimensions are within icon size range (8–80px).
 * The name + type checks are the real quality gate — size is just a rough filter
 * to avoid collecting full-page frames and large layout components.
 */
function isIconSize(node: FigmaNode): boolean {
  const bbox = node.absoluteBoundingBox;
  if (!bbox) return false;
  return bbox.width >= 8 && bbox.width <= 80 && bbox.height >= 8 && bbox.height <= 80;
}

/**
 * Walk the full node tree recursively.
 * ❌ Rejected adding FRAME to isIconType — too many false positives (layout frames)
 * INSTANCE/COMPONENT covers 99% of real icon usage in Figma design systems.
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

// ✅ #5 — null-guard SVG URLs (Figma returns null for invisible/non-renderable nodes)
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
    const res = await withRetry(() =>
      axios.get(`${FIGMA_BASE}/images/${fileKey}`, {
        headers: { "X-Figma-Token": token },
        params: {
          ids: chunk.join(","),
          format: "svg",
          svg_include_id: false,
          svg_simplify_stroke: true,
        },
      })
    );
    // Guard against null URLs — Figma returns null for invisible/non-renderable nodes
    const images = res.data.images as Record<string, string | null>;
    for (const [id, url] of Object.entries(images)) {
      if (url != null) result[id] = url;
    }
  }
  return result;
}

/** Download SVG content from a URL */
export async function fetchSVGContent(url: string): Promise<string> {
  const res = await withRetry(() => axios.get(url, { responseType: "text" }));
  return res.data as string;
}