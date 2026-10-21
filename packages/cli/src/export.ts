import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Platform = "ios" | "android";

/** Shape of dist/metadata.json written by `expo export`. */
export interface ExportMetadata {
  version: number;
  bundler: string;
  fileMetadata: Partial<Record<string, { bundle: string; assets: { path: string; ext: string }[] }>>;
}

export interface LocalAsset {
  path: string;
  /** Hex sha256. Doubles as the asset key on the server. */
  key: string;
  contentType: string;
  fileExtension: string;
  size: number;
}

export interface PlatformBundle {
  platform: Platform;
  launchAsset: LocalAsset;
  assets: LocalAsset[];
}

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  json: "application/json",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  lottie: "application/json",
};

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}

async function hashFile(path: string): Promise<{ key: string; size: number }> {
  const bytes = await readFile(path);
  return { key: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength };
}

export async function readExport(distDir: string, platforms: Platform[]): Promise<PlatformBundle[]> {
  const metadata: ExportMetadata = JSON.parse(await readFile(join(distDir, "metadata.json"), "utf8"));
  const bundles: PlatformBundle[] = [];
  for (const platform of platforms) {
    const meta = metadata.fileMetadata[platform];
    if (!meta) throw new Error(`metadata.json has no ${platform} entry; was it exported?`);
    const bundlePath = join(distDir, meta.bundle);
    const launch = await hashFile(bundlePath);
    const assets: LocalAsset[] = [];
    const seen = new Set<string>([launch.key]);
    for (const a of meta.assets) {
      const path = join(distDir, a.path);
      const { key, size } = await hashFile(path);
      if (seen.has(key)) continue;
      seen.add(key);
      assets.push({ path, key, size, contentType: contentTypeFor(a.ext), fileExtension: `.${a.ext}` });
    }
    bundles.push({
      platform,
      launchAsset: {
        path: bundlePath,
        ...launch,
        contentType: "application/javascript",
        fileExtension: ".bundle",
      },
      assets,
    });
  }
  return bundles;
}
