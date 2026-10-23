import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The promo reuses the screenshots that ship with the download page, so there is only
// one copy of every image in the repository.
const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, "..", "..", "docs", "media");
const to = path.resolve(here, "..", "public");

fs.mkdirSync(to, { recursive: true });
for (const name of ["dashboard", "remote", "devices"]) {
  const src = path.join(from, `${name}.png`);
  if (!fs.existsSync(src)) throw new Error(`missing source screenshot: ${src}`);
  fs.copyFileSync(src, path.join(to, `${name}.png`));
  console.log(`synced ${name}.png`);
}
