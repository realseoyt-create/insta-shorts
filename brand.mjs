// 꿀벌 캐릭터 이미지 만들기:  node brand.mjs
//   brand/bee.png          배경 없는 캐릭터 (스티커·썸네일용)
//   brand/bee-profile.png  배경 있는 정사각형 (프로필·하이라이트 표지용)
import path from "node:path";
import fs from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { ROOT, BROWSER } from "./lib.mjs";

const browserExecutable = BROWSER ?? null;
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), publicDir: path.join(ROOT, "public") });
await fs.mkdir(path.join(ROOT, "brand"), { recursive: true });
for (const [file, bg] of [["bee.png", false], ["bee-profile.png", true]]) {
  const inputProps = { bg };
  const composition = await selectComposition({ serveUrl, id: "Bee", inputProps, browserExecutable });
  await renderStill({ composition, serveUrl, output: path.join(ROOT, "brand", file), inputProps, imageFormat: "png", browserExecutable });
  console.log("저장:", path.join("brand", file));
}
process.exit(0);
