// 설명형 쇼츠 한 편 만들기:  node explainers/make.mjs explainers/001-expiry [--inbox]
//   1) episode.json의 줄마다 음성을 만들고 길이와 낱말 시각을 잼 (어림하지 않음)
//   2) 그 길이에 맞춰 그 편의 화면(Video.tsx)을 영상으로 뽑음  → out/<id>.mp4
//   3) 0.5초 간격 장면 시트(out/sheet-1.png …)와 기록(out/record.html)을 만듦
//   4) --inbox 를 붙이면 세바꿀 서버의 inbox 폴더에 넘김 → 검토 대기로 들어감
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { ROOT, BROWSER, CONFIG, alignWords, timeWords } from "../lib.mjs";
import { synth } from "../tts.mjs";

const FPS = 30, LEAD = 0.15, GAP = 0.28, TAIL = 0.9;
const started = Date.now();
const dir = path.resolve(process.argv[2] ?? "");
const toInbox = process.argv.includes("--inbox");
const ep = JSON.parse(await fs.readFile(path.join(dir, "episode.json"), "utf8"));
const out = path.join(dir, "out"), pub = path.join(dir, "public");
await fs.mkdir(path.join(pub, "audio"), { recursive: true });
await fs.mkdir(out, { recursive: true });

// 1) 음성
let t = 0, exact = 0;
const lines = [];
for (const l of ep.lines) {
  const file = path.join(pub, "audio", `${l.id}.mp3`);
  const a = await synth(l.text, file);
  const aligned = a.marks && alignWords(l.text, a.marks);
  if (aligned) exact++;
  // 첫 줄: 화면은 0프레임부터 보이고(표지), 목소리만 조금 뒤에 시작
  const lead = lines.length ? 0 : Math.round(LEAD * FPS), shift = (lead / FPS) * 1000;
  const words = (aligned || timeWords(l.text, a.seconds)).map((w) => ({ ...w, startMs: w.startMs + shift, endMs: w.endMs + shift }));
  lines.push({ id: l.id, text: l.text, caption: l.caption, lead, audio: a.file ? `audio/${l.id}.mp3` : null, from: Math.round(t * FPS), frames: lead + Math.ceil((a.seconds + 0.05) * FPS), seconds: a.seconds, words });
  t += lead / FPS;
  console.log(`음성 ${l.id}: ${a.seconds.toFixed(2)}초 ${a.file ? "" : "(무음)"}`);
  t += a.seconds + GAP;
}
lines[lines.length - 1].frames += Math.round(TAIL * FPS);       // 마지막 화면을 조금 더 보여 줌
const total = lines[lines.length - 1].from + lines[lines.length - 1].frames;
const inputProps = { handle: CONFIG.handle, lines: lines.map(({ seconds, ...l }) => l) };

// 2) 영상
const serveUrl = await bundle({ entryPoint: path.join(dir, "index.ts"), publicDir: pub });
const browserExecutable = BROWSER ?? null;
const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, browserExecutable });
const mp4 = path.join(out, `${ep.id}.mp4`);
console.log(`영상 뽑는 중 (${(total / FPS).toFixed(1)}초)…`);
await renderMedia({ composition, serveUrl, codec: "h264", crf: 20, audioCodec: "aac", outputLocation: mp4, inputProps, browserExecutable, chromiumOptions: { gl: "angle" } });
const size = (await fs.stat(mp4)).size;

// 3) 장면 시트: 0.5초 간격, 한 장에 30장면
const shots = [];
for (let f = 0; f < total; f += FPS / 2) {
  const file = path.join(out, "frames", `f${String(f).padStart(5, "0")}.jpg`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await renderStill({ composition, serveUrl, frame: Math.min(f, total - 1), output: file, inputProps, imageFormat: "jpeg", jpegQuality: 80, scale: 0.22, browserExecutable });
  shots.push({ file, sec: f / FPS });
}
const { default: puppeteer } = await import("puppeteer-core");
const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true });
const sheets = [];
for (let i = 0; i * 30 < shots.length; i++) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1560, height: 900 });
  const cells = await Promise.all(shots.slice(i * 30, i * 30 + 30).map(async (s) => `<div><img src="data:image/jpeg;base64,${(await fs.readFile(s.file)).toString("base64")}"><p>${s.sec.toFixed(1)}초</p></div>`));
  await page.setContent(`<body style="margin:0;background:#222;color:#ddd;font:15px sans-serif"><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:10px">${cells.join("")}</div><style>img{width:100%;display:block}p{margin:2px 0 6px;text-align:center}</style></body>`);
  const file = path.join(out, `sheet-${i + 1}.png`);
  await page.screenshot({ path: file, fullPage: true });
  sheets.push(file);
  await page.close();
}
await browser.close();

// 기록
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const took = Math.round((Date.now() - started) / 1000);
await fs.writeFile(path.join(out, "record.html"), `<!doctype html><meta charset="utf-8"><title>${esc(ep.title)} — 제작 기록</title>
<body style="font:16px/1.7 sans-serif;max-width:860px;margin:30px auto;padding:0 20px">
<h1>${esc(ep.title)}</h1>
<p>영상: ${esc(path.basename(mp4))} · ${(total / FPS).toFixed(1)}초 · 1080×1920 · 30fps · ${(size / 1e6).toFixed(1)}MB · 만든 시각 ${new Date().toLocaleString("ko-KR")} · 걸린 시간 ${took}초</p>
<h2>내레이션 전문 (줄별 실제 길이)</h2><ol>${lines.map((l) => `<li>${esc(l.text)} <small>(${l.seconds.toFixed(2)}초, 시작 ${(l.from / FPS).toFixed(2)}초)</small></li>`).join("")}</ol>
<h2>화면에 쓴 숫자·인용과 출처</h2><ul>${ep.sources.map((s) => `<li>${esc(s.text)}<br><small>${esc(s.source)} — <a href="${esc(s.url)}">${esc(s.url)}</a></small></li>`).join("")}</ul>
<h2>소리</h2><p>음성: ${esc(process.env.TTS_PROVIDER ?? "edge")} / ${esc(process.env.TTS_VOICE ?? "ko-KR-SunHiNeural")} (속도 ${esc(process.env.TTS_RATE ?? "+12%")}). 낱말 시각을 정확히 받은 줄 ${exact}/${lines.length}. 줄 사이 ${GAP}초, 마지막 화면 ${TAIL}초 더 유지(끝이 잘리지 않게). 배경음·효과음 없음.</p>
<h2>메모</h2><p>${esc(ep.notes)}</p>
<h2>캡션</h2><pre style="white-space:pre-wrap">${esc(ep.caption)}\n\n${esc(ep.hashtags)}</pre></body>`);

// 4) 세바꿀 서버에 넘기기: 글 파일 먼저, 영상 나중
if (toInbox) {
  const inbox = path.join(ROOT, "inbox");
  await fs.mkdir(inbox, { recursive: true });
  await fs.writeFile(path.join(inbox, `${ep.id}.json`), JSON.stringify({ title: ep.title, caption: ep.caption, hashtags: ep.hashtags, sources: ep.sources, notes: ep.notes }, null, 2));
  await fs.copyFile(mp4, path.join(inbox, `${ep.id}.part`));
  await fs.rename(path.join(inbox, `${ep.id}.part`), path.join(inbox, `${ep.id}.mp4`));
  console.log("inbox 폴더에 넘겼습니다 (서버가 20~40초 안에 검토 대기에 넣습니다)");
}
console.log(`완료: ${mp4}\n길이 ${(total / FPS).toFixed(1)}초, ${(size / 1e6).toFixed(1)}MB, 시트 ${sheets.length}장, ${took}초 걸림\n${sheets.join("\n")}`);
process.exit(0);
