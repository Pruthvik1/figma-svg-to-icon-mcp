import fs from "fs";
import path from "path";
import Fuse from "fuse.js";
import { extractPaths } from "./svg-utils.js";

export interface ExistingIcon {
  name: string;
  fileName: string;
  filePath: string;
  paths: string[];
}

export function loadExistingIcons(iconsDir: string): ExistingIcon[] {
  if (!fs.existsSync(iconsDir)) return [];
  const files = fs.readdirSync(iconsDir).filter((f) => f.endsWith(".tsx"));
  const icons: ExistingIcon[] = [];
  for (const file of files) {
    const filePath = path.join(iconsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const name = file.replace(".tsx", "");
    const paths = extractPaths(content);
    icons.push({ name, fileName: file, filePath, paths });
  }
  return icons;
}

export interface MatchResult {
  isNew: boolean;
  matchedIcon?: ExistingIcon;
  matchType?: "name" | "paths";
  similarity?: number;
}

export function findSimilarIcon(
  newName: string,
  newPaths: string[],
  existingIcons: ExistingIcon[]
): MatchResult {
  if (existingIcons.length === 0) return { isNew: true };

  // 1. Fuzzy NAME match
  const fuse = new Fuse(existingIcons, {
    keys: ["name"],
    threshold: 0.3,
    includeScore: true,
  });

  const nameResults = fuse.search(newName);
  if (nameResults.length > 0) {
    const best = nameResults[0];
    const similarity = 1 - (best.score ?? 1);
    if (similarity > 0.7) {
      return {
        isNew: false,
        matchedIcon: best.item,
        matchType: "name",
        similarity: Math.round(similarity * 100),
      };
    }
  }

  // 2. SVG PATH similarity match
  if (newPaths.length > 0) {
    for (const existing of existingIcons) {
      const score = pathSimilarity(newPaths, existing.paths);
      if (score >= 0.85) {
        return {
          isNew: false,
          matchedIcon: existing,
          matchType: "paths",
          similarity: Math.round(score * 100),
        };
      }
    }
  }

  return { isNew: true };
}

function pathSimilarity(pathsA: string[], pathsB: string[]): number {
  if (pathsA.length === 0 && pathsB.length === 0) return 1;
  if (pathsA.length === 0 || pathsB.length === 0) return 0;
  const tokenize = (paths: string[]) =>
    new Set(paths.join(" ").split(/[\s,]+/).filter(Boolean).map((t) => t.substring(0, 6)));
  const setA = tokenize(pathsA);
  const setB = tokenize(pathsB);
  let intersection = 0;
  setA.forEach((t) => { if (setB.has(t)) intersection++; });
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function writeIconFile(
  iconsDir: string,
  componentName: string,
  tsxContent: string
): string {
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }
  const filePath = path.join(iconsDir, `${componentName}.tsx`);
  fs.writeFileSync(filePath, tsxContent, "utf-8");
  return filePath;
}
