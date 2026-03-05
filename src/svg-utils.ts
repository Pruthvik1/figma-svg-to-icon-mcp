/** Convert a name to PascalCase */
export function toPascalCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .split(/[\s_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("")
    .replace(/^(\d)/, "_$1");
}

// All SVG kebab-case attributes → React camelCase
const ATTR_MAP: Record<string, string> = {
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "clip-path": "clipPath",
  "font-size": "fontSize",
  "font-family": "fontFamily",
  "font-weight": "fontWeight",
  "text-anchor": "textAnchor",
  "dominant-baseline": "dominantBaseline",
  "color-interpolation-filters": "colorInterpolationFilters",
  "flood-color": "floodColor",
  "flood-opacity": "floodOpacity",
  "lighting-color": "lightingColor",
  "marker-end": "markerEnd",
  "marker-mid": "markerMid",
  "marker-start": "markerStart",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "shape-rendering": "shapeRendering",
  "image-rendering": "imageRendering",
  "color-rendering": "colorRendering",
  "vector-effect": "vectorEffect",
  "paint-order": "paintOrder",
};

/** Convert all kebab-case SVG attributes to React camelCase */
function toReactAttrs(svg: string): string {
  for (const [kebab, camel] of Object.entries(ATTR_MAP)) {
    svg = svg.replaceAll(`${kebab}=`, `${camel}=`);
  }
  return svg;
}

/** Replace hardcoded colors with currentColor, keep fill="none" */
function normalizeColors(svg: string): string {
  svg = svg.replace(/fill="(?!none)(?!currentColor)[^"]*"/g, 'fill="currentColor"');
  svg = svg.replace(/stroke="(?!none)(?!currentColor)[^"]*"/g, 'stroke="currentColor"');
  return svg;
}

/** Remove Figma junk: ids, data-attrs, xmlns, clip wrappers */
function cleanupAttributes(svg: string): string {
  svg = svg.replace(/\s*data-name="[^"]*"/g, "");
  svg = svg.replace(/\s*id="[^"]*"/g, "");
  svg = svg.replace(/\s*xmlns="[^"]*"/g, "");
  svg = svg.replace(/\s*xmlns:xlink="[^"]*"/g, "");
  return svg;
}

/**
 * Figma often exports SVGs wrapped in a <g clip-path="url(#...)"> with a matching
 * <defs><clipPath id="..."><rect .../></clipPath></defs>
 * This is just a bounding box mask — it adds no visual info, so we strip it:
 *
 * Before:
 *   <defs><clipPath id="clip0_26050_31747"><rect width="20" height="20" fill="white"/></clipPath></defs>
 *   <g clip-path="url(#clip0_26050_31747)">
 *     <path d="..."/>
 *   </g>
 *
 * After:
 *   <path d="..."/>
 */
function unwrapFigmaClipWrapper(svg: string): string {
  // Remove entire <defs>...</defs> block if it only contains clipPath with a rect
  svg = svg.replace(/<defs>\s*<clipPath[^>]*>\s*<rect[^/]*\/>\s*<\/clipPath>\s*<\/defs>/g, "");

  // Unwrap <g clip-path="url(#...)">...</g> → just the inner content
  svg = svg.replace(/<g\s+clip-path="url\(#[^)]+\)"\s*>([\s\S]*?)<\/g>/g, (_, inner) => inner.trim());

  // Also remove any leftover empty <defs> blocks
  svg = svg.replace(/<defs>\s*<\/defs>/g, "");

  return svg;
}

/** Format each SVG element with each attribute on its own indented line */
function formatElements(svg: string): string {
  svg = svg.replace(/\s+/g, " ").trim();

  svg = svg.replace(
    /<(path|circle|rect|line|polyline|polygon|ellipse|g|mask|defs|clipPath|linearGradient|radialGradient|stop|use)([^>]*?)(\/?>)/g,
    (_, tag, attrs, closing) => {
      const isSelfClosing = closing === "/>";
      const attrList = attrs
        .trim()
        .split(/(?=\s[a-zA-Z])/g)
        .map((a: string) => a.trim())
        .filter(Boolean);

      if (attrList.length === 0) {
        return isSelfClosing ? `<${tag} />` : `<${tag}>`;
      }

      const formattedAttrs = attrList.map((a: string) => `        ${a}`).join("\n");
      return isSelfClosing
        ? `      <${tag}\n${formattedAttrs}\n      />`
        : `      <${tag}\n${formattedAttrs}\n      >`;
    }
  );

  return svg;
}

/** Extract viewBox and fully processed inner SVG content */
export function extractSVGInternals(svgRaw: string): {
  viewBox: string;
  innerContent: string;
} {
  const viewBoxMatch = svgRaw.match(/viewBox=["']([^"']+)["']/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : "0 0 24 24";

  const innerMatch = svgRaw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  let inner = innerMatch ? innerMatch[1].trim() : "";

  // Order matters:
  inner = unwrapFigmaClipWrapper(inner); // 1. Remove Figma clip wrapper first
  inner = cleanupAttributes(inner);      // 2. Strip junk attributes
  inner = normalizeColors(inner);        // 3. Replace hardcoded colors
  inner = toReactAttrs(inner);           // 4. kebab → camelCase
  inner = formatElements(inner);         // 5. Pretty format

  return { viewBox, innerContent: inner };
}

/** Extract path 'd' values for similarity comparison */
export function extractPaths(svgRaw: string): string[] {
  const matches = svgRaw.match(/\sd="([^"]+)"/g) || [];
  return matches.map((m) => m.replace(/\sd="/, "").replace(/"$/, "").trim());
}

/** Generate TSX component in your exact format */
export function generateTSX(
  componentName: string,
  viewBox: string,
  innerContent: string
): string {
  return `interface IconProps {
  className?: string;
}

export default function ${componentName}({ className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="${viewBox}"
      fill="none"
      className={className}
    >
      ${innerContent}
    </svg>
  );
}
`;
}