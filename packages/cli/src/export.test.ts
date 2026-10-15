import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentTypeFor, readExport } from "./export";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("readExport", () => {
  it("hashes the bundle and assets listed in metadata.json and dedupes repeats", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tidepush-test-"));
    await mkdir(join(dir, "_expo/static/js/android"), { recursive: true });
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "_expo/static/js/android/entry-abc.hbc"), "bundle");
    await writeFile(join(dir, "assets/a1"), "icon");
    await writeFile(join(dir, "assets/a2"), "icon"); // same bytes as a1
    await writeFile(join(dir, "assets/f1"), "font");
    await writeFile(
      join(dir, "metadata.json"),
      JSON.stringify({
        version: 0,
        bundler: "metro",
        fileMetadata: {
          android: {
            bundle: "_expo/static/js/android/entry-abc.hbc",
            assets: [
              { path: "assets/a1", ext: "png" },
              { path: "assets/a2", ext: "png" },
              { path: "assets/f1", ext: "ttf" },
            ],
          },
        },
      }),
    );

    const [android] = await readExport(dir, ["android"]);
    expect(android!.launchAsset).toMatchObject({
      key: sha("bundle"),
      contentType: "application/javascript",
      fileExtension: ".bundle",
      size: 6,
    });
    expect(android!.assets.map((a) => [a.key, a.contentType, a.fileExtension])).toEqual([
      [sha("icon"), "image/png", ".png"],
      [sha("font"), "font/ttf", ".ttf"],
    ]);

    await expect(readExport(dir, ["ios"])).rejects.toThrow("no ios entry");
  });

  it("maps unknown extensions to octet-stream", () => {
    expect(contentTypeFor("PNG")).toBe("image/png");
    expect(contentTypeFor("xyz")).toBe("application/octet-stream");
  });
});
