// 관리 화면 서버 + 예약 실행
//   ADMIN_PASSWORD 없음 → 이 PC에서만 접속 (http://localhost:3200)
//   ADMIN_PASSWORD 있음 → 외부 접속 허용 + 로그인 필요 (배포용)
//   SCHEDULE=09:00,18:00 → 그 시각마다 수집 + 영상 1건 제작
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { ROOT, OUT, CONFIG, loadDb, updateDb, patchTip, collect, produce, runDaily, approveAndPublish, planShootItem, planCardItem, cardFromTip, refreshLinks, linksEnabled, linksUrl, approveTip, unapproveTip, publishNext, reviewTick, startTelegram, tgInfo, postTimes, upcomingSlots, saveClip, saveShot, resetTip, getLogs, log } from "./lib.mjs";

// 예상하지 못한 오류가 나도 서버가 통째로 꺼지지 않게 하고, 이유를 기록에 남김
process.on("uncaughtException", (e) => log(`예상하지 못한 오류 (서버는 계속 실행): ${e?.stack ?? e}`));
process.on("unhandledRejection", (e) => log(`처리되지 않은 오류 (서버는 계속 실행): ${e?.stack ?? e}`));

const PORT = Number(process.env.PORT ?? process.env.ADMIN_PORT ?? 3200);
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const HOST = process.env.HOST ?? (PASSWORD ? "0.0.0.0" : "127.0.0.1");
const json = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
async function readBody(req) {
  let raw = ""; for await (const c of req) { raw += c; if (raw.length > 200_000) throw new Error("본문이 너무 큽니다"); }
  return raw ? JSON.parse(raw) : {};
}
const bg = (p) => { p.catch((e) => log(`오류: ${e.message}`)); return { ok: true }; };   // 오래 걸리는 작업은 백그라운드로

function authorized(req) {
  if (!PASSWORD) return true;
  const given = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString().split(":").slice(1).join(":");
  const a = crypto.createHash("sha256").update(given).digest(), b = crypto.createHash("sha256").update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

let dailyRunning = false;
async function daily() {
  if (dailyRunning) return log("이미 실행 중입니다");
  dailyRunning = true;
  try { await runDaily(); } finally { dailyRunning = false; }
}

const KEYS = ["GEMINI_API_KEY", "YOUTUBE_API_KEY", "APIFY_TOKEN", "PIXABAY_API_KEY", "CLOUDINARY_CLOUD", "IG_ACCESS_TOKEN"];
const routes = {
  "GET /api/tips": async () => (await loadDb()).slice().reverse(),
  "GET /api/logs": async () => getLogs().slice(-100),
  "POST /api/links": async () => (linksEnabled() ? bg(refreshLinks()) : Promise.reject(new Error(".env에 GITHUB_TOKEN과 GITHUB_REPO가 없습니다"))),
  "GET /api/info": async () => ({ handle: CONFIG.handle, schedule: process.env.SCHEDULE ?? "", links: linksEnabled() ? linksUrl() : "",
    postTimes: postTimes(), slots: upcomingSlots(40).map((d) => d.toISOString()), telegram: tgInfo(),
    keys: Object.fromEntries(KEYS.map((k) => [k, Boolean(process.env[k] || (k === "PIXABAY_API_KEY" && process.env.PEXELS_API_KEY))])) }),
  "POST /api/collect": async () => bg(collect()),
  "POST /api/daily": async () => bg(daily()),
  "POST /api/tips": async (_, body) => {
    const text = String(body.tip_text ?? "").trim();
    if (text.length < 5) throw new Error("주제나 원문을 5자 이상 입력하세요");
    const tip = { shortCode: `manual-${Date.now().toString(36)}`, source: "manual", url: String(body.url ?? ""), owner: "직접 입력",
      views: 0, likes: 0, comments: 0, score: 0, tip_text: text.slice(0, 1500), status: "new", collected_at: new Date().toISOString() };
    await updateDb((db) => db.push(tip));
    return tip;
  },
  "POST /api/shoots": async (_, body) => {
    const topic = String(body.topic ?? "").trim().slice(0, 1500), format = String(body.format ?? "auto");
    if (format === "items" && topic.split("\n").filter((l) => l.trim()).length < 2) throw new Error("꿀템 형식은 물건을 한 줄에 하나씩, 2개 이상 적어 주세요");
    return bg(planShootItem(topic, format));
  },
  "POST /api/cards": async (_, body) => bg(planCardItem(String(body.topic ?? "").trim().slice(0, 1500), String(body.label ?? "").trim().slice(0, 80), body.script ?? null,
    ["news", "sites"].includes(body.kind) ? body.kind : "")),
  "POST /api/tips/:id/card": async (id) => bg(cardFromTip(id)),
  "POST /api/tips/:id/generate": async (id) => bg(produce(id)),
  "POST /api/tips/:id/render": async (id, body) => bg(produce(id, body.script)),
  "POST /api/tips/:id/approve": async (id) => ({ ok: true, message: await approveTip(id) }),      // 승인 = 발행 예약 (정해진 시각에 올라감)
  "POST /api/tips/:id/unapprove": async (id) => unapproveTip(id),
  "POST /api/tips/:id/publish": async (id) => bg(approveAndPublish(id)),                           // 지금 바로 발행
  "POST /api/tips/:id/reject": async (id) => patchTip(id, { status: "rejected" }),
  "POST /api/tips/:id/reset": async (id) => resetTip(id),
};

http.createServer(async (req, res) => {
  try {
    if (!authorized(req)) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="shorts-admin", charset="UTF-8"' }); return res.end("로그인이 필요합니다"); }
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/health") return res.end("ok");
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(await fs.readFile(path.join(ROOT, "admin.html")));
    }
    if (req.method === "GET" && url.pathname.startsWith("/img/")) {       // 카드뉴스 이미지
      const file = path.join(OUT, path.basename(decodeURIComponent(url.pathname.slice(5))));
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": statSync(file).size, "Cache-Control": "max-age=3600" });
      return createReadStream(file).pipe(res);
    }
    if (req.method === "GET" && url.pathname.startsWith("/video/")) {
      const file = path.join(OUT, path.basename(decodeURIComponent(url.pathname.slice(7))));
      const size = statSync(file).size;
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
      if (m) {
        const start = Number(m[1] || 0), end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        res.writeHead(206, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
        return createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": size });
      return createReadStream(file).pipe(res);
    }
    const parts = url.pathname.split("/");                 // /api/tips/:id/action
    const id = parts[3] && parts[4] ? decodeURIComponent(parts[3]) : null;
    if (req.method === "POST" && id && parts[4] === "clip") {   // 직접 찍은 장면 영상 올리기: /api/tips/:id/clip/:장면번호
      return json(res, 200, await saveClip(id, Number(parts[5]), req, decodeURIComponent(req.headers["x-filename"] ?? "")));
    }
    if (req.method === "POST" && id && parts[4] === "shot") {   // 카드뉴스에 넣을 화면 사진 올리기
      return json(res, 200, await saveShot(id, req, decodeURIComponent(req.headers["x-filename"] ?? "")));
    }
    const handler = routes[`${req.method} ${id ? `/api/tips/:id/${parts[4]}` : url.pathname}`];
    if (!handler) return json(res, 404, { error: "없는 경로" });
    json(res, 200, await handler(id, req.method === "POST" ? await readBody(req) : null));
  } catch (e) {
    json(res, e.code === "ENOENT" ? 404 : 400, { error: e.message });
  }
}).listen(PORT, HOST, () => log(`관리 화면: http://localhost:${PORT} ${PASSWORD ? "(로그인 필요, 외부 접속 허용)" : "(이 PC 전용)"}`));

// 자동 실행 (서버 시간 기준, 20초마다 확인)
//   SCHEDULE   = 새 게시물을 만드는 시각 (수집 + 제작 → 검토 대기)
//   POST_TIMES = 승인한 게시물을 올리는 시각 (한 번에 하나씩)
//   텔레그램 봇이 연결돼 있으면 검토할 것을 하나씩 보내 줌
const makeTimes = (process.env.SCHEDULE ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{2}:\d{2}$/.test(s));
if (makeTimes.length) log(`자동 제작: 매일 ${makeTimes.join(", ")}`);
if (postTimes().length) log(`자동 발행: 매일 ${postTimes().join(", ")} (승인한 것만, 한 번에 하나씩)`);
let lastMake = "", lastPost = "";
setInterval(() => {
  const d = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const key = `${d.toDateString()} ${hm}`;
  if (makeTimes.includes(hm) && key !== lastMake) { lastMake = key; log(`자동 제작 시작 (${hm})`); daily().catch((e) => log(`자동 제작 오류: ${e.message}`)); }
  if (postTimes().includes(hm) && key !== lastPost) { lastPost = key; log(`자동 발행 시각 (${hm})`); publishNext().catch((e) => log(`자동 발행 오류: ${e.message}`)); }
  reviewTick();
}, 20_000);
startTelegram().catch((e) => log(`텔레그램 봇을 켜지 못했습니다: ${e.message}`));
