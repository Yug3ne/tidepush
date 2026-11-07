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

export async function readExport(distDir: string, platforms: Platform[]): Promise<PlatformBundle[]> {
  const metadata: ExportMetadata = JSON.parse(await readFile(join(distDir, "metadata.json"), "utf8"));
  // Every file is hashed once, all at the same time (ios and android share most assets).
  const hashes = new Map<string, Promise<{ key: string; size: number }>>();
  const hash = (path: string) => {
    let h = hashes.get(path);
    if (!h) {
      h = readFile(path).then((bytes) => ({
        key: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
      }));
      hashes.set(path, h);
    }
    return h;
  };

  return Promise.all(
    platforms.map(async (platform): Promise<PlatformBundle> => {
      const meta = metadata.fileMetadata[platform];
      if (!meta) throw new Error(`metadata.json has no ${platform} entry; was it exported?`);
      const bundlePath = join(distDir, meta.bundle);
      const files = meta.assets.map((a) => ({ path: join(distDir, a.path), ext: a.ext }));
      const [launch, ...hashed] = await Promise.all([hash(bundlePath), ...files.map((f) => hash(f.path))]);
      const assets: LocalAsset[] = [];
      const seen = new Set<string>([launch!.key]);
      files.forEach(({ path, ext }, i) => {
        const { key, size } = hashed[i]!;
        if (seen.has(key)) return;
        seen.add(key);
        assets.push({ path, key, size, contentType: contentTypeFor(ext), fileExtension: `.${ext}` });
      });
      return {
        platform,
        launchAsset: {
          path: bundlePath,
          ...launch!,
          contentType: "application/javascript",
          fileExtension: ".bundle",
        },
        assets,
      };
    }),
  );
}
