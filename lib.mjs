// 공용 기능: 트렌드 수집 · 대본 · 음성/자막/배경 준비 · 렌더 · 업로드 · 발행 · 데이터 저장
import "dotenv/config";
import fs from "node:fs/promises";
import { existsSync, createWriteStream, appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { parseFile } from "music-metadata";
import { synth } from "./tts.mjs";
import { linksEnabled, linksUrl, okUrl, publishLinks } from "./links.mjs";
import { tgEnabled, tgPaired, tgInfo, tgStart, tgSendReview, tgNotify } from "./telegram.mjs";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(ROOT, "out");
const DB = path.join(ROOT, "data", "tips.json");
const CLIPS = path.join(ROOT, "data", "clips");      // 직접 찍어 올린 영상
const ASSETS = path.join(ROOT, "assets");
const FPS = 30;
const LOGS = [];
const has = (k) => Boolean(process.env[k]);
const env = (k) => { const v = process.env[k]; if (!v) throw new Error(`.env에 ${k}가 없습니다`); return v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url, init) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), ...init });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
};

export function log(...a) {
  const line = `${new Date().toLocaleTimeString()} ${a.join(" ")}`;
  console.log(line); LOGS.push(line); if (LOGS.length > 300) LOGS.shift();
  // 서버가 꺼져도 이유를 볼 수 있게 파일에도 남김 (data/server.log)
  try { mkdirSync(path.join(ROOT, "data"), { recursive: true }); appendFileSync(path.join(ROOT, "data", "server.log"), `${new Date().toISOString().slice(0, 10)} ${line}\n`); } catch { /* 기록 실패는 무시 */ }
}
export const getLogs = () => LOGS;

// ── 관리 화면에서 바꾸는 설정 (data/settings.json). .env보다 먼저 적용되고, 저장하면 서버를 다시 켜지 않아도 바로 반영됨 ──
const SETTINGS_FILE = path.join(ROOT, "data", "settings.json");
const TIMES = /^(([01]\d|2[0-3]):[0-5]\d)(\s*,\s*([01]\d|2[0-3]):[0-5]\d)*$/;
const SETTING_RULES = {                                  // 항목: 값이 맞는지 확인하는 규칙
  SCHEDULE: (v) => v === "" || TIMES.test(v), POST_TIMES: (v) => v === "" || TIMES.test(v),
  STOCK_TARGET: (v) => /^\d{1,2}$/.test(v) && Number(v) >= 1, DAILY_CARDS: (v) => /^[0-3]$/.test(v), DAILY_NEWS: (v) => /^[01]$/.test(v), SHOOT_PLANS: (v) => /^[0-5]$/.test(v),
  PAUSE_MAKE: (v) => /^[01]$/.test(v), PAUSE_POST: (v) => /^[01]$/.test(v),
};
const SECRET_SETTINGS = ["KOPIS_KEY", "TOUR_API_KEY"];   // 열쇠: 화면에는 "넣었는지"만 알려 주고 값은 돌려주지 않음
let savedSettings = {};
try { savedSettings = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")); } catch { /* 저장한 설정 없음 */ }
for (const [k, v] of Object.entries(savedSettings)) if (k in SETTING_RULES || SECRET_SETTINGS.includes(k)) process.env[k] = String(v);
export const getSettings = () => ({
  ...Object.fromEntries(Object.keys(SETTING_RULES).map((k) => [k, process.env[k] ?? ""])),
  STOCK_TARGET: String(CONFIG.stockTarget), DAILY_CARDS: String(CONFIG.dailyCards), DAILY_NEWS: CONFIG.dailyNews > 0 ? "1" : "0", SHOOT_PLANS: String(CONFIG.shootPlans),
  PAUSE_MAKE: process.env.PAUSE_MAKE === "1" ? "1" : "0", PAUSE_POST: process.env.PAUSE_POST === "1" ? "1" : "0",
  keys: Object.fromEntries(SECRET_SETTINGS.map((k) => [k, has(k)])),
});
export async function saveSettings(patch) {
  const next = { ...savedSettings };
  for (const [k, raw] of Object.entries(patch ?? {})) {
    const v = String(raw ?? "").trim();
    if (SECRET_SETTINGS.includes(k)) { if (v) next[k] = v; continue; }           // 열쇠는 빈칸이면 그대로 둠
    if (!(k in SETTING_RULES)) continue;
    const clean = v.replace(/\s+/g, "");
    if (!SETTING_RULES[k](clean)) throw new Error(`${k} 값이 맞지 않습니다: "${v}" (시각은 09:00처럼, 여러 개는 쉼표로)`);
    next[k] = clean;
  }
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2));
  savedSettings = next;
  for (const [k, v] of Object.entries(next)) process.env[k] = String(v);
  log("설정을 저장했습니다");
  return getSettings();
}
const num = (k, d) => { const n = Number(process.env[k] ?? d); return Number.isFinite(n) ? n : d; };

// ── 수집 설정 (원하는 분야로 수정) ──
export const CONFIG = {
  handle: process.env.IG_HANDLE ?? "@sebaggul",
  mascot: process.env.MASCOT_NAME ?? "바꿀이",      // 꿀벌 캐릭터 이름 (영상 마지막 화면·직접 촬영 영상에 표시)
  // 세바꿀 분야: 일상 꿀팁 전반 (살림, 먹거리·간식·다이어트 식단, 생활용품, 절약). IT·AI는 다루지 않음
  youtubeQueries: ["cleaning hacks", "kitchen hacks", "home organization hacks", "laundry hacks", "food hacks", "healthy snack ideas", "money saving hacks"],
  instagramHashtags: ["cleaninghacks", "kitchenhacks", "homeorganization", "foodhacks", "healthysnacks", "lifehacks"],
  // 카드뉴스 주제 후보: 한국에서 공감(좋아요·댓글) 많은 쇼츠를 찾는 검색어
  koreaQueries: ["생활 꿀팁", "살림 꿀팁", "몰랐던 꿀팁", "유용한 사이트", "자취 꿀팁", "돈 아끼는 꿀팁"],
  // 카드뉴스 주제 후보: 최근 게시물을 살펴볼 인스타 본보기 계정 (토큰 권한이 있을 때만 동작)
  benchmarkAccounts: (process.env.BENCHMARK_ACCOUNTS ?? "ggul_yang,lady_good_tip").split(",").map((s) => s.trim()).filter(Boolean),
  // 아래 네 가지는 관리 화면의 설정에서 바꿀 수 있어서, 쓸 때마다 지금 값을 읽음
  get dailyCards() { return num("DAILY_CARDS", 1); },     // 매일 자동으로 만들 카드뉴스 수 (0이면 안 만듦)
  get dailyNews() { return num("DAILY_NEWS", 1); },        // 매일 "이번 주 소식"(할인·팝업·행사) 카드뉴스를 만들지 (0이면 안 만듦)
  get stockTarget() { return num("STOCK_TARGET", 8); },   // 검토 대기 + 발행 예약이 이만큼 쌓여 있으면 자동 제작을 쉼
  perSource: 5,          // 한 번 수집할 때 출처별로 쌓을 소재 수
  candidates: 25,        // AI가 고르기 전 조회수 상위 후보 수
  minFit: 50,            // 추천 점수(0~100)가 이보다 낮은 후보는 쌓지 않음
  affiliateNotice: process.env.AFFILIATE_NOTICE ?? "",   // 제휴 링크를 쓰면 캡션 끝에 붙일 고지 문구 (꿀템 영상)
  get shootPlans() { return num("SHOOT_PLANS", 2); },   // 촬영 대기 기획을 이 개수까지 미리 만들어 둠 (0이면 자동 기획 안 함)
};

// ── 데이터: 매번 파일에서 읽고 바로 저장 ──
let lock = Promise.resolve();
export async function loadDb() { try { return JSON.parse(await fs.readFile(DB, "utf8")); } catch { return []; } }
export function updateDb(fn) {
  const run = lock.then(async () => {
    const db = await loadDb();
    const r = await fn(db);
    await fs.mkdir(path.dirname(DB), { recursive: true });
    await fs.writeFile(DB, JSON.stringify(db, null, 2));
    return r;
  });
  lock = run.catch(() => {});
  return run;
}
export const patchTip = (code, patch) => updateDb((db) => { const t = db.find((x) => x.shortCode === code); if (t) Object.assign(t, patch); return t; });

// ── 1. 트렌드 수집 ──
// 유튜브: 최근 7일, 짧은 영상, 조회수 순 (YOUTUBE_API_KEY, 무료 한도 하루 1만 단위 중 검색 1회 100단위)
async function youtubeSearch(queries, { language, region, days, prefix, source }) {
  const key = env("YOUTUBE_API_KEY");
  const after = new Date(Date.now() - days * 864e5).toISOString();
  const ids = new Set();
  for (const q of queries) {
    const s = await getJson(`https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
      part: "id", q: `${q} #shorts`, type: "video", videoDuration: "short", order: "viewCount",
      publishedAfter: after, relevanceLanguage: language, ...(region && { regionCode: region }), maxResults: "15", key })}`);
    for (const it of s.items ?? []) if (it.id?.videoId) ids.add(it.id.videoId);
  }
  const out = [];
  const list = [...ids];
  for (let i = 0; i < list.length; i += 50) {
    const v = await getJson(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "snippet,statistics", id: list.slice(i, i + 50).join(","), key })}`);
    for (const it of v.items ?? []) {
      out.push({ shortCode: `${prefix}-${it.id}`, source, url: `https://www.youtube.com/shorts/${it.id}`, owner: it.snippet.channelTitle,
        views: Number(it.statistics.viewCount ?? 0), likes: Number(it.statistics.likeCount ?? 0), comments: Number(it.statistics.commentCount ?? 0),
        tip_text: `${it.snippet.title}\n${(it.snippet.description ?? "").slice(0, 800)}`.trim() });
    }
  }
  return out;
}
// ── 시의성: 지금 시기에 맞는 주제를 먼저 고르기 위한 신호 ──
// 달마다 한국에서 관심이 몰리는 생활 주제 (수집 검색어, 소재 점수, 카드뉴스 주제 고르기에 씀)
const SEASON = {
  1: ["새해 대청소·정리", "설 명절 준비", "한파·동파 예방", "연말정산", "겨울 난방비", "딸기·귤"],
  2: ["명절 음식 보관", "졸업·입학 준비", "이사 준비", "미세먼지", "겨울옷 세탁·보관", "봄맞이 정리"],
  3: ["봄맞이 대청소", "이사·입주 청소", "새 학기 준비", "미세먼지·황사", "겨울 이불 정리", "봄나물"],
  4: ["옷장 계절 정리", "소풍 도시락", "꽃가루·황사", "에어컨 청소 준비", "베란다 정리"],
  5: ["가정의 달 선물", "에어컨 청소", "여름옷 꺼내기", "나들이 준비", "벌레 예방"],
  6: ["장마 대비 제습", "곰팡이 예방", "여름 음식 보관", "모기·초파리", "에어컨 전기요금"],
  7: ["폭염·열대야", "휴가 짐 싸기", "장마철 빨래 냄새", "여름 과일 보관", "전기요금 아끼기"],
  8: ["휴가 뒤 정리", "늦더위", "개학 준비", "태풍 대비", "여름 이불 세탁"],
  9: ["추석 명절 준비", "명절 음식 보관", "환절기 옷 정리", "가을 대청소", "햇과일 고르기"],
  10: ["환절기 이불 교체", "가을 옷 정리", "난방 준비", "김장 준비", "나들이 도시락"],
  11: ["김장", "패딩·겨울옷 관리", "난방비 아끼기", "귤 보관", "수능 도시락", "연말 할인 장보기", "가습기 관리"],
  12: ["한파·동파 예방", "연말정산 준비", "연말 모임 음식", "겨울 이불", "연말 대청소", "난방비"],
};
export const seasonHints = (d = new Date()) => SEASON[d.getMonth() + 1] ?? [];

// 구글 인기 검색어 (한국, 공개 RSS). 6시간에 한 번만 받음. 대부분 뉴스·스포츠라 생활과 관련 있는 것만 AI가 골라 씀
let trendCache = { at: 0, terms: [] };
async function trendingKorea() {
  if (Date.now() - trendCache.at < 6 * 3600e3) return trendCache.terms;
  let terms = [];
  try {
    const xml = await (await fetch("https://trends.google.com/trending/rss?geo=KR", { signal: AbortSignal.timeout(20_000) })).text();
    terms = [...xml.matchAll(/<item>[\s\S]*?<title>([^<]+)<\/title>/g)].map((m) => m[1].trim()).slice(0, 15);
  } catch { /* 못 받아도 계절 주제만으로 진행 */ }
  trendCache = { at: Date.now(), terms };
  return terms;
}
async function timelyNote() {
  const d = new Date();
  return `[지금 시기] 오늘은 ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일(한국)이다.
이 시기에 사람들이 찾는 생활 주제: ${seasonHints(d).join(", ")}
오늘 한국의 인기 검색어 (대부분 뉴스·스포츠다. 날씨·물가·명절·장보기처럼 생활과 관련 있는 것만 참고하라): ${(await trendingKorea()).join(", ") || "(없음)"}`;
}

// 해외 인기 쇼츠 (꿀팁 영상 소재): 조회수 순
const collectYoutube = async () => (await youtubeSearch(CONFIG.youtubeQueries, { language: "en", days: 7, prefix: "yt", source: "youtube" }))
  .map((x) => ({ ...x, score: x.views }));
// 한국 인기 쇼츠 (카드뉴스 주제 후보): 공감 순 = 좋아요 + 댓글×3
// 고정 검색어에 더해, 이번 달의 생활 주제 2개를 날마다 돌아가며 검색해 지금 시기에 뜨는 것을 잡음
const collectYoutubeKorea = async () => {
  const hints = seasonHints(), day = Math.floor(Date.now() / 864e5);
  const seasonal = hints.length ? [0, 1].map((k) => `${hints[(day * 2 + k) % hints.length].split("·")[0]} 꿀팁`) : [];
  return (await youtubeSearch([...CONFIG.koreaQueries, ...seasonal], { language: "ko", region: "KR", days: 7, prefix: "ytkr", source: "youtube_kr" }))
    .map((x) => ({ ...x, score: x.likes + x.comments * 3, suggest: "card" }));
};

// 인스타 본보기 계정의 최근 게시물 (카드뉴스 주제 후보): 공식 API의 "다른 비즈니스 계정 조회" 사용.
// 토큰에 instagram_manage_insights, pages_read_engagement 권한이 있어야 하고, 없으면 조용히 건너뜀
async function collectBenchmarks() {
  const out = [];
  if (env("IG_ACCESS_TOKEN").startsWith("IG")) return out;
  for (const name of CONFIG.benchmarkAccounts) {
    const fields = `business_discovery.username(${name}){media.limit(25){id,caption,like_count,comments_count,permalink,timestamp}}`;
    const d = await (await fetch(`https://graph.facebook.com/${process.env.GRAPH_VERSION ?? "v21.0"}/${env("IG_USER_ID")}?${new URLSearchParams({ fields, access_token: env("IG_ACCESS_TOKEN") })}`,
      { signal: AbortSignal.timeout(60_000) })).json();
    if (d.error?.code === 10) { log("인스타 본보기 계정 수집 건너뜀: 토큰에 권한이 더 필요합니다 (instagram_manage_insights, pages_read_engagement)"); return out; }
    if (d.error) { log(`인스타 본보기 계정 ${name} 건너뜀: ${d.error.message.slice(0, 120)}`); continue; }
    const recent = Date.now() - 30 * 864e5;
    for (const m of d.business_discovery?.media?.data ?? []) {
      if ((m.caption?.length ?? 0) < 40 || new Date(m.timestamp).getTime() < recent) continue;
      out.push({ shortCode: `ig-${m.id}`, source: "instagram", url: m.permalink, owner: name, views: 0, likes: m.like_count ?? 0, comments: m.comments_count ?? 0,
        score: (m.like_count ?? 0) + (m.comments_count ?? 0) * 3, tip_text: m.caption.slice(0, 1200), suggest: "card" });
    }
  }
  return out;
}

// 인스타그램: 해시태그 인기 게시물 (APIFY_TOKEN, 사용량만큼 과금 — 무료 크레딧 범위 권장)
async function collectInstagram() {
  const posts = await getJson(`https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items?token=${env("APIFY_TOKEN")}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(300_000),
    body: JSON.stringify({ hashtags: CONFIG.instagramHashtags, resultsType: "posts", resultsLimit: 15 }),
  });
  return posts.filter((p) => p.shortCode && p.caption?.length > 40).map((p) => ({
    shortCode: `ig-${p.shortCode}`, source: "instagram", url: p.url, owner: p.ownerUsername,
    views: p.videoPlayCount ?? 0, likes: p.likesCount ?? 0, comments: p.commentsCount ?? 0,
    score: (p.likesCount ?? 0) + (p.commentsCount ?? 0) * 3, tip_text: p.caption.slice(0, 1200) }));
}

export async function collect() {
  const sources = [["YOUTUBE_API_KEY", "유튜브(해외)", collectYoutube], ["YOUTUBE_API_KEY", "유튜브(한국 공감)", collectYoutubeKorea],
    ["IG_ACCESS_TOKEN", "인스타 본보기 계정", collectBenchmarks], ["APIFY_TOKEN", "인스타 해시태그", collectInstagram]];
  let added = 0, ran = 0;
  for (const [key, label, fn] of sources) {
    if (!has(key)) { log(`${label} 수집 건너뜀 (.env에 ${key} 없음)`); continue; }
    ran++;
    try {
      log(`${label} 수집 시작`);
      const items = await fn();
      const known = new Set((await loadDb()).map((t) => t.shortCode));
      let fresh = items.filter((x) => !known.has(x.shortCode)).sort((a, b) => b.score - a.score).slice(0, CONFIG.candidates);
      try {                                      // 조회수 상위 후보를 AI가 골라 어울리는 것만 남김
        const picked = await curate(fresh);
        fresh = fresh.map((x) => ({ ...x, ...picked.get(x.shortCode) })).filter((x) => x.fit >= CONFIG.minFit)
          .sort((a, b) => b.fit - a.fit).slice(0, CONFIG.perSource);
      } catch (e) { log(`소재 고르기 실패 — 조회수 순으로 추가: ${e.message.slice(0, 120)}`); fresh = fresh.slice(0, CONFIG.perSource); }
      added += await updateDb((db) => {
        const seen = new Set(db.map((t) => t.shortCode));
        const add = fresh.filter((x) => !seen.has(x.shortCode)).map((x) => ({ ...x, status: "new", collected_at: new Date().toISOString() }));
        db.push(...add);
        log(`${label}: 후보 ${items.length}건 중 어울리는 새 소재 ${add.length}건 추가`);
        return add.length;
      });
    } catch (e) { log(`${label} 수집 오류: ${e.message}`); }
  }
  if (!ran) log("수집할 출처가 없습니다. .env에 YOUTUBE_API_KEY 또는 APIFY_TOKEN을 넣거나 '직접 소재 추가'를 쓰세요");
  await curateExisting().catch((e) => log(`소재 고르기 오류: ${e.message.slice(0, 120)}`));
  return added;
}

// ── 1-2. 소재 고르기: 한국어 제목·요약을 붙이고, 계정에 어울리고 한국 사람이 재미있어할수록 높은 점수(fit)를 줌 ──
async function curate(items) {
  if (!items.length) return new Map();
  const prompt = `너는 한국 인스타그램 릴스 계정 "세바꿀(세상을 바꾸는 꿀팁)"의 소재 담당이다.
아래 [후보]는 지금 해외나 한국에서 반응이 좋은 영상·게시물의 제목과 설명이다(조회수, 좋아요, 댓글 수 포함). 후보마다 한국어로 정리하고, 우리 계정 소재로 얼마나 좋은지 0~100점(fit)으로 매겨라.

점수 기준 (셋 다 좋아야 80점 이상):
1. 계정과 어울림: 누구나 일상에서 바로 써먹는 꿀팁인가. 분야는 살림(청소, 주방, 정리·수납, 세탁), 먹거리(간식, 간편식, 다이어트 식단·식품), 생활용품, 생활비 절약. IT·AI, 음악, 게임, 챌린지, 단순 브이로그, 광고는 20점 이하. 단, 생활에 쓰는 사이트·앱·공공 서비스를 알려 주는 내용(숨은 돈 찾기, 지원금 조회 등)은 IT로 보지 않고 일상 꿀팁으로 본다.
2. 보는 재미: "어? 이건 몰랐네" 하는 의외성이 있는가, 하기 전과 후의 차이가 눈에 확 보이는가, 보고 나서 바로 따라 해 보고 싶은가. 누구나 아는 뻔한 내용은 감점.
3. 한국 사람 취향: 한국 집(아파트·원룸), 한국 주방과 식재료, 다이소·마트·편의점에서 구할 수 있는 물건으로 통하는가. 한국에 흔하지 않은 물건이나 환경(마당, 차고, 대형 오븐, 건조기 시트 등)이 중심이면 감점. 한국 사람이 특히 좋아하는 주제(라면·김치·밥 보관, 편의점 꿀조합, 다이소 물건, 욕실 곰팡이, 옷장·신발장 정리, 배달 음식 남은 것 활용)면 가점.

4. 지금 시기: 아래 [지금 시기]에 딱 맞는 소재(제철, 계절 준비, 지금 사람들이 겪는 문제)면 10~15점을 더 주고 timely를 true로 하라. 철이 지났거나 한참 남은 소재(지금이 겨울인데 여름 휴가 짐 싸기 등)는 15점을 깎아라. 시기와 상관없는 소재는 그대로 두고 timely는 false.

${await timelyNote()}

작성 규칙:
- title: 한국 사람이 눌러 보고 싶게 한국어로 새로 쓴 제목 (22자 이내). 직역하지 말고 과장도 하지 마라.
- summary: 무슨 내용인지 한국어 한 문장.
- why: 이 점수를 준 이유 한 문장 (예: "다이소 물건으로 바로 따라 할 수 있고 전후 차이가 큼").
- 후보를 빠짐없이, 번호(no)를 그대로 달아 답하라.

[후보]
${items.map((t, i) => `#${i + 1} (${[t.views && `조회 ${Number(t.views).toLocaleString()}`, t.likes && `좋아요 ${Number(t.likes).toLocaleString()}`, t.comments && `댓글 ${Number(t.comments).toLocaleString()}`].filter(Boolean).join(", ") || "수치 없음"})\n${t.tip_text.slice(0, 400)}`).join("\n\n")}

JSON으로만 답하라: {"items":[{"no":1,"title":"","summary":"","fit":0,"timely":false,"why":""}]}`;
  const d = await askGemini(prompt);
  const out = new Map();
  const rows = Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : Object.values(d ?? {}).find(Array.isArray) ?? [];
  for (const [i, x] of rows.entries()) {
    const no = Number(String(x?.no ?? "").replace(/\D/g, "")) || i + 1;      // "#3"처럼 와도 읽고, 번호가 없으면 순서대로
    const t = items[no - 1];
    const s = (v) => String(v ?? "").trim();
    if (t && s(x?.title)) out.set(t.shortCode, { ko_title: s(x.title), ko_summary: s(x.summary), fit: Math.max(0, Math.min(100, Math.round(Number(x.fit) || 0))), timely: x.timely === true, why: s(x.why) });
  }
  if (!out.size) throw new Error(`AI가 후보를 평가하지 못했습니다: ${JSON.stringify(d).slice(0, 200)}`);
  return out;
}

// 아직 점수가 없는 기존 새 소재에 한국어 제목과 점수를 붙임
export async function curateExisting() {
  const todo = (await loadDb()).filter((t) => t.status === "new" && t.type !== "shoot" && t.source !== "manual" && t.fit == null);
  for (let i = 0; i < todo.length; i += CONFIG.candidates) {
    const picked = await curate(todo.slice(i, i + CONFIG.candidates));
    await updateDb((db) => { for (const t of db) if (picked.has(t.shortCode)) Object.assign(t, picked.get(t.shortCode)); });
    log(`소재 ${picked.size}건에 한국어 제목과 추천 점수를 붙였습니다`);
  }
}

// 만들 순서: 직접 넣은 소재 → 추천 점수 높은 순 → 조회수 순
const rank = (t) => (t.source === "manual" ? 101 : t.fit ?? -1);
const byRank = (a, b) => rank(b) - rank(a) || b.score - a.score;

// ── 2. 대본: 트렌드는 주제 참고만, 내용은 새로 작성 (인스타 원본 콘텐츠 정책 대응) ──
// 앞 모델의 무료 한도가 끝났거나 응답이 없으면 다음 모델로 넘어감
// images: 함께 보여 줄 사진 [{ mime, data(base64) }]. rounds: 모두 실패했을 때 다시 시도하는 횟수
const resting = new Map();              // 한도가 찬 AI 모델 → 다시 써 볼 시각
// fast: 간단한 판단용 — 가벼운 모델부터 쓰고 25초만 기다림
async function askGemini(prompt, { images = [], rounds = 3, temperature = 0.9, fast = false } = {}) {
  // 무료 한도는 모델마다 따로 있음 (2026-11-12 확인: 3.8-flash 하루 20회, flash-lite-latest 하루 500회). 한도가 찬 모델은 15분 쉬게 하고 다음 모델을 씀
  const list = (process.env.GEMINI_MODEL ?? "gemini-3.8-flash,gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3-flash-preview,gemini-3.1-flash-lite-preview")
    .split(",").map((m) => m.trim()).filter(Boolean);
  const awake = (fast ? [...list].reverse() : list).filter((m) => (resting.get(m) ?? 0) < Date.now());
  const models = awake.length ? awake : list;
  const parts = [{ text: prompt }, ...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } }))];
  let d, lastError;
  for (let round = 0; round < rounds && !d; round++) {     // 모두 실패하면(혼잡 등) 잠시 쉬고 처음부터 다시
    if (round) await sleep(15_000);
    for (const model of models) {
      try {
        d = await getJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env("GEMINI_API_KEY")}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(fast ? 25_000 : 60_000),
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature } }),
        });
        break;
      } catch (e) {
        lastError = e;
        const full = / 429:/.test(e.message);
        if (full) resting.set(model, Date.now() + 15 * 60_000);
        log(full ? `AI 모델 ${model}: 무료 한도가 차서 15분 쉬고 다음 모델을 씁니다` : `AI 모델 ${model} 실패 → 다음 시도: ${e.message.slice(0, 120).replace(/\s+/g, " ")}`);
      }
    }
  }
  if (!d) throw new Error(`AI 작성 실패: ${lastError.message.slice(0, 300)}`);
  return JSON.parse(d.candidates[0].content.parts[0].text.replace(/^```json\s*|\s*```$/g, ""));
}

// 첫 문구(후킹) 규칙: 유입은 첫 1초에 결정되므로 모든 대본에 공통으로 넣음
// 사용자가 "더 트렌디하고 세련되게"를 요청해 짧고 말하듯 하는 문구로 바꿨고, 같은 틀이 반복되지 않게 최근 문구를 함께 넘김
async function hookRules() {
  const recent = (await loadDb()).filter((t) => t.script?.hook && ["pending", "approved", "posted"].includes(t.status)).slice(-14).map((t) => t.script.hook);
  return `${HOOK_RULES}
- [최근에 쓴 첫 문구] 아래와 같은 틀(문장 끝 모양, 시작하는 말)을 또 쓰지 마라. 같은 틀이 두 번 넘게 보이면 반드시 다른 틀로 써라.
${recent.map((h) => `  · ${h}`).join("\n") || "  · (없음)"}`;
}
const HOOK_RULES = `- hook이 가장 중요하다. 넘기던 손가락을 1초 안에 멈추게 해야 한다. 요즘 인스타그램에서 통하는, 짧고 말하듯 하는 세련된 문구로 써라.
  · 짧게: 한 호흡에 읽히게. 군더더기 수식어를 빼고 핵심 낱말만 남겨라.
  · 말투: 친구한테 툭 던지는 말. 설명문, 광고 문구, 뉴스 제목처럼 쓰지 마라.
  · 쓸 만한 틀 (그대로 베끼지 말고 주제에 맞게 바꿔 써라):
    "나만 몰랐던 ○○", "○○, 이게 정답이었네", "이거 알면 ○○ 끝", "의외로 다들 틀리는 ○○", "아는 사람만 아는 ○○",
    "○○ 살 때 딱 이것만", "요즘 ○○는 이렇게 해요", "○○ 망치는 습관", "○○ 쓰는 집 주목", "이건 저장해 둬야 함", "○○인 줄 알았는데 아니었음"
  · 금지: "○○하는 방법", "꿀팁 모음", "총정리" 같은 밋밋한 제목. "충격", "대박", "역대급", "소름" 같은 낡은 낚시 말투. 느낌표 두 개 이상. 이모지.
  · 금지: "호구", "개○○" 같은 비속어와 보는 사람을 깎아내리는 말. 세련되고 기분 좋게 읽혀야 한다.
  단, 내용이 지켜 주지 못할 약속은 금지다(효과 과장, 근거 없는 숫자, "무조건·100%·200%·확 낮추는"). 궁금하게 만들되 거짓말은 안 된다.
  hook에 쓴 말은 slides 안에 그 근거가 있어야 한다. 겁을 주려고 없는 불이익(압수, 벌금, 큰일 난다)을 지어내지 마라.
  hook이 약속한 주제와 모든 slides가 맞아야 한다 ("살 때"라고 했으면 고르는 법만, "3가지"라고 했으면 3가지).
  서로 다른 방식으로 후보 3개를 만든 뒤, 가장 강한 것을 hook에 넣고 나머지 2개를 hook_alts에 넣어라.
- caption의 첫 줄은 hook과 다른 말로 한 번 더 궁금하게 만드는 한 문장이어야 한다 (인스타에서는 "더 보기"를 누르기 전에 이 줄만 보인다).`;

export async function writeScript(tip, trendTitles = []) {
  const prompt = `너는 한국 인스타그램 릴스 계정 "세바꿀(세상을 바꾸는 꿀팁)"의 작가다. 이 계정은 누구나 일상에서 바로 써먹는 꿀팁을 다룬다: 살림(청소, 주방, 정리·수납, 세탁), 먹거리(간식, 간편식, 다이어트 식단·식품 고르는 법, 보관법), 생활용품, 생활비 절약.
아래 [소재]는 지금 해외에서 반응이 좋은 영상/게시물의 제목·설명이다.
이것을 번역하거나 문장을 가져오지 말고, "어떤 주제가 뜨는지"만 참고해서 한국 생활에 맞는 실용 꿀팁 쇼츠 대본을 네 지식으로 완전히 새로 써라.

규칙:
- 말투는 옆집 언니·오빠가 알려 주듯 친근하고 쉽게. 어려운 말 금지.
- 실제로 효과가 있고 안전한 팁만. 불확실한 사실·수치·의학적 주장·위험한 방법은 금지.
- 불이 나거나 감전될 수 있는 방법(종이 상자에 멀티탭 넣기, 전기 제품 덮기, 세제 섞기 등)은 절대 쓰지 마라.
- 과일·채소 등 제철이 있는 주제는 지금 계절(${new Date().getMonth() + 1}월, 한국)에 맞는 것을 골라라.
- 한국에서 구하기 쉬운 물건·상황으로 바꿔라.
${await hookRules()}
- 먹거리·다이어트 주제는 고르는 법, 먹는 법, 보관법, 대체 재료처럼 생활 요령으로만 써라. "살이 빠진다", "몸에 좋다", 질병·체중 효과 같은 효능은 말하지 마라.
- 누구나 아는 뻔한 조언(물 마시기, 일찍 자기 등)은 빼고, "이건 몰랐다" 싶은 구체적인 방법만 써라.
- 팁 3개는 하나의 주제로 묶여야 한다.
- hook은 16자 이내 한 문장.
- slides: 팁 3개. title은 12자 이내 명사형. body는 소리 내어 읽을 자연스러운 구어체 한 문장(22~38자, "~하세요/~돼요" 체).
- keyword: 그 장면의 배경 영상 검색어. 화면에 실제로 보여야 할 사물을 영어 명사 1~2단어로 (예: "bed bedroom", "apple fruit", "washing machine"). 동작("making", "cleaning")이나 추상적인 말은 쓰지 마라. 앞 낱말이 가장 구체적인 사물이어야 한다. 영상을 못 찾을 때를 대비해 쉼표로 대체 검색어를 2~3개 이어 적어라 (예: "kitchen sink, sink, kitchen").
- cta: 저장·공유를 유도하는 한 문장 (16자 이내).
- caption: 250자 이내, 첫 줄에 핵심. 마지막 줄은 "🐝 ${CONFIG.mascot}가 알려 주는 꿀팁"으로 끝내라. hashtags: 한국어 해시태그 10개를 공백으로 구분.
- product: 이 꿀팁에 쓰이는 대표 물건 하나 (예: "과탄산소다", "압축봉"). 특정 브랜드명은 쓰지 마라. 없으면 빈 문자열.
- 소재가 일상 꿀팁으로 만들 수 없는 내용(음악, 게임, 뉴스, 광고, IT·AI, 의학·치료 등)이면 {"skip": true, "reason": "이유"}만 답하라.

[소재]
${tip.tip_text}

[요즘 함께 뜨는 주제 참고]
${trendTitles.map((t) => `- ${t}`).join("\n") || "- (없음)"}

JSON으로만 답하라: {"hook":"","hook_alts":["",""],"slides":[{"title":"","body":"","keyword":""}],"cta":"","caption":"","hashtags":"","product":""}`;
  const parsed = await askGemini(prompt);
  if (parsed.skip) return { skip: true, reason: String(parsed.reason ?? "꿀팁 소재가 아님") };
  return normalizeScript(parsed);
}

// 직접 촬영용 기획: 장면마다 "무엇을 찍을지(shoot)"와 "깔릴 내레이션(body)"을 함께 씀
const SHOOT_FORMATS = {
  verify: "꿀팁 검증 — 요즘 도는 살림 꿀팁 하나를 직접 해 보고 결과를 솔직하게 보여 준다.",
  product: "살까 말까 — 살림 물건 하나를 직접 써 보고 좋은 점과 아쉬운 점을 솔직하게 말한다.",
};
// "꿀템 N가지" 형식: 주인이 적은 물건 목록으로 물건마다 한 장면씩 기획하고, 번호 매긴 긴 캡션을 조립
async function planItems(list) {
  if (!list) throw new Error("꿀템 형식은 물건 목록이 필요합니다 (한 줄에 하나씩)");
  const prompt = `너는 한국 일상 꿀팁 인스타그램 계정 "세바꿀(세상을 바꾸는 꿀팁)"의 촬영 기획자다.
계정 주인이 직접 써 본 물건 여러 개를 릴스 한 편으로 소개한다("꿀템 N가지" 형식). 주인은 기획대로 물건마다 5~8초씩 찍기만 하면 된다.
[물건 목록]은 주인이 적은 것이다. 한 줄에 물건 하나이고, " - " 뒤는 주인이 실제로 써 본 느낌이다. 첫 줄이 주제(예: 여행템)일 수도 있다.

규칙:
- slides는 물건마다 하나씩, 목록 순서대로 (최대 5개).
- 주인이 적은 느낌만 사실로 써라. 적지 않은 경험·효과·가족 이야기·가격을 지어내지 마라. 느낌이 없으면 어디에 쓰는 물건인지만 담백하게 써라.
- "낫는다, 예방된다, 살이 빠진다" 같은 효능 단정 금지. 브랜드명은 주인이 적은 경우에만 써라.
- title: 물건 이름 (14자 이내).
- shoot: 그 물건을 어떻게 찍을지 한두 문장. 반드시 그 물건이 화면 가운데에 나오게, 손으로 실제 쓰는 모습을 가까이서, 세로로.
- body: 그 장면에 깔릴 내레이션 한 문장(18~34자). 물건 이름을 먼저 말하고 왜 좋은지를 잇는다. "~해요 / ~더라고요" 체.
- detail: 캡션에 들어갈 그 물건 설명 2~3문장. 옆집 언니가 말하듯 친근하게, 이모지 1~2개.
- hook: 영상 제목(16자 이내). "미리 사 두는 여행템 5가지", "나만 알기 아까운 주방템 3가지"처럼 주제와 개수를 넣어라. 거짓 과장은 금지.
- hook_shoot: 첫 화면에 찍을 것 (예: 물건을 한데 모아 놓고 위에서 찍기).
- keyword: 구매처를 받으려는 사람이 댓글로 남길 단어 (2~4자, 예: "여행템").
- intro: 캡션 첫 문단 1~2문장. 누구에게 필요한지 말해라.
- cta: 16자 이내, 저장이나 댓글을 유도. name: 기획 제목(20자 이내). items: 준비물(물건 이름들)을 쉼표로.
- hashtags: 한국어 해시태그 6개를 공백으로 구분. "내돈내산"처럼 확인되지 않은 사실은 금지.

[물건 목록]
${list}

JSON으로만 답하라: {"name":"","items":"","hook":"","hook_shoot":"","keyword":"","intro":"","slides":[{"title":"","shoot":"","body":"","detail":""}],"cta":"","hashtags":""}`;
  const raw = await askGemini(prompt);
  const s = (v) => String(v ?? "").trim();
  const rows = (Array.isArray(raw?.slides) ? raw.slides : []).slice(0, 5);
  const caption = [
    s(raw.intro),
    `✅ 댓글에 "${s(raw.keyword) || "꿀템"}" 남겨 주시면 구매처 보내 드릴게요 (프로필 링크에도 있어요)`,
    "",
    ...rows.flatMap((x, i) => [`${["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"][i]} ${s(x.title)}`, s(x.detail), ""]),
    `🐝 ${CONFIG.mascot}가 직접 써 봤어요`,
    CONFIG.affiliateNotice,
  ].filter((line, i, all) => line || (i > 0 && all[i - 1])).join("\n").trim();
  const script = normalizeScript({ ...raw, slides: rows, caption });
  if (script.slides.length < 2 || !script.hook_shoot || script.slides.some((x) => !x.shoot)) throw new Error("촬영 기획 형식 오류: 물건별 촬영 안내가 빠졌습니다");
  return script;
}

export async function planShoot(topic, format, candidates) {
  if (format === "items") return planItems(topic);
  const formatText = SHOOT_FORMATS[format] ?? `아래 둘 중 주제에 더 맞는 것을 골라라.\n  1) ${SHOOT_FORMATS.verify}\n  2) ${SHOOT_FORMATS.product}`;
  const prompt = `너는 한국 일상 꿀팁 인스타그램 계정 "세바꿀(세상을 바꾸는 꿀팁)"의 촬영 기획자다.
계정 주인이 집에서 스마트폰으로 직접 찍어 올릴 "직접 해 봤어요" 릴스 1편의 촬영 기획을 써라.
주인은 촬영 초보다. 기획대로 장면 4개만 찍어 올리면 음성·자막·편집은 자동으로 처리된다.

형식: ${formatText}
주제: ${topic || "아래 [후보]에서 하나를 골라라. 집에 흔히 있는 물건으로 10분 안에 찍을 수 있고, 하기 전과 후의 차이가 눈에 보이는 것이어야 한다."}

규칙:
- 얼굴 없이 손과 물건만 나온다. 세로로 찍고, 한 장면은 5~8초다.
- 준비물은 집에 있거나 다이소·마트에서 5천 원 안쪽으로 살 수 있는 것만. 위험한 방법(세제 섞기, 불, 날카로운 도구, 전기 제품 분해)은 금지.
- 주제는 일상 꿀팁 안에서 고른다: 살림(청소, 주방, 정리·수납, 세탁), 먹거리(간식, 간편식, 다이어트 식품 맛·양·먹는 법), 생활용품. IT·AI는 제외.
- 먹거리는 맛, 양, 가격, 먹는 법만 말하고 "살이 빠진다" 같은 효능은 말하지 마라.
- slides는 정확히 3개. 순서: 첫 화면(문제 상황이나 궁금한 순간) → 1 문제·준비물 → 2 하는 방법 → 3 결과.
- shoot, hook_shoot: 그 장면에서 무엇을 어떻게 찍을지 초보도 따라 할 수 있게 한두 문장으로. 구도(위에서 / 옆에서 / 가까이)와 손동작을 구체적으로.
- body: 그 장면에 깔릴 내레이션. 소리 내어 읽을 자연스러운 구어체 한 문장(20~36자), "~했어요 / ~더라고요" 체의 1인칭 경험담.
- 아직 해 보기 전이므로 결과를 미리 단정하지 마라. hook은 결과를 말하지 말고 궁금하게만 만들어라(14자 이내).
- 3번 장면만 body에 효과가 있었을 때의 문장을, alt에 기대만큼은 아니었을 때의 솔직한 문장을 둘 다 써라. 1·2번 장면의 alt는 빈 문자열.
- 광고처럼 들리는 표현, 과장, 특정 브랜드명 금지. "내돈내산"처럼 확인되지 않은 사실을 말하는 해시태그도 금지.
- title: 장면 제목, 12자 이내. cta: 16자 이내, 저장이나 댓글을 유도.
- name: 이 기획을 한눈에 알 수 있는 제목(20자 이내). items: 준비물을 쉼표로 구분.
- caption: 250자 이내, 직접 해 봤다는 사실과 방법 위주로. 결과 평가는 "결과는 영상에서 확인하세요" 정도로만 쓰고 단정하지 마라. 마지막 줄은 "🐝 ${CONFIG.mascot}가 직접 해 봤어요"로 끝내라. hashtags: 한국어 해시태그 10개를 공백으로 구분.

[후보]
${candidates.ideas.map((t) => `- ${t}`).join("\n") || "- (없음: 살림·생활 분야에서 직접 골라라)"}

[이미 기획한 주제 — 겹치지 않게]
${candidates.taken.map((t) => `- ${t}`).join("\n") || "- (없음)"}

JSON으로만 답하라: {"name":"","items":"","hook":"","hook_shoot":"","slides":[{"title":"","shoot":"","body":"","alt":""}],"cta":"","caption":"","hashtags":""}`;
  const script = normalizeScript(await askGemini(prompt));
  script.slides = script.slides.slice(0, 3);
  script.slides.forEach((x, i) => { if (i < script.slides.length - 1) delete x.alt; });   // 결과 장면에만 대체 문장을 둠
  if (script.slides.length < 2 || !script.hook_shoot || script.slides.some((x) => !x.shoot)) throw new Error("촬영 기획 형식 오류: 장면별 촬영 안내가 빠졌습니다");
  return script;
}

// ── 카드뉴스 대본: 공감형 주제로 표지 + 내용 5~7장 + 마무리 ──
// sites: true면 "트렌디한 사이트 추천" 카드뉴스 (장마다 사이트 주소가 꼭 들어감)
export async function writeCards(topic, trendTitles = [], { sites = false } = {}) {
  const prompt = `너는 한국 인스타그램 계정 "세바꿀(세상을 바꾸는 꿀팁)"의 카드뉴스 작가다.
보는 사람이 "이건 저장해 둬야겠다" 하며 저장하고 친구를 태그할 만한 공감형 꿀팁 카드뉴스 1편을 써라.

주제: ${topic || "직접 골라라. 한국 사람이면 누구나 한 번쯤 궁금했거나 겪는 상황이면서, 사진으로 보여 줘야 이해가 쉬운 주제여야 한다 (예: 냉장고에 넣으면 안 되는 식재료, 전자레인지에 넣으면 안 되는 것, 제철 과일 보관법, 겨울옷 종류별 보관법, 프라이팬 오래 쓰는 법). 아래 [요즘 뜨는 주제]도 참고하라."}

규칙:
- 카드뉴스는 사진이 주인공이다. 장마다 사진 한 장으로 보여 줄 수 있는 구체적인 사물(음식, 물건, 집 안 장소)이 있어야 한다. 제도·세금·절차처럼 글로만 설명되는 장은 최소로 하라.
- 각 장의 photo: 그 장에 넣을 사진의 검색어. 화면에 보여야 할 사물을 영어 명사 1~2단어로 (예: "potato", "frying pan", "wool sweater"). 앞 낱말이 가장 구체적인 사물이어야 하고, 동작이나 추상적인 말은 쓰지 마라. 사진을 못 찾을 때를 대비해 쉼표로 대체 검색어를 2~3개 이어 적어라 (예: "coat, hanger, wardrobe"). 사이트를 소개하는 장(url이 있는 장)은 빈 문자열.
- cover_photo: 표지 배경 사진의 검색어 (같은 방식). 주제를 한눈에 보여 주는 사물로.
- 다른 게시물의 문장을 가져오지 말고, 주제만 참고해 네 지식으로 새로 써라.
- slides는 5~7장, 한 장에 한 가지만. title은 14자 이내, body는 2~3문장(40~90자)으로 친근한 "~해요" 체.
- 확실한 사실만 써라. 금액·세율·기한·제도 이름은 확실할 때만 쓰고, 바뀔 수 있는 숫자에는 "약"이나 "기준은 바뀔 수 있어요"를 붙여라.
- 의학·법률 판단, 투자 권유, 특정 상품 광고는 금지.${sites ? "" : " IT·AI 주제도 금지."}
${sites
    ? `- 이 카드뉴스는 사이트 추천이다. 모든 장에 그 사이트의 공식 https 주소(url)와 정확한 이름(site)을 넣어라. 지금도 운영 중이고 주소가 맞다고 네가 확신하는 곳만 골라라. 조금이라도 헷갈리면 다른 곳을 골라라.
- body에는 그 사이트에서 무엇을 할 수 있는지, 언제 쓰면 좋은지를 써라. 가격·회원 수 같은 숫자는 쓰지 마라.`
    : `- 사이트나 앱을 소개하는 장에만 url을 넣어라. 정부·공공기관이나 누구나 아는 공식 서비스의 정확한 https 주소만 쓰고, 확실하지 않으면 빈 문자열로 둬라. site에는 서비스의 정확한 공식 이름을 적어라.`}
- 사이트를 소개하는 장의 body에는 그 사이트에서 실제로 할 수 있는 일만 써라. 사이트와 설명이 어긋나면 안 된다. 같은 사이트를 두 장에 쓰지 마라.
- 맞춤법을 지켜라 (멤버십, 환급 등).
${await hookRules()}
- hook은 표지 제목이다 (18자 이내). sub는 표지 아래 한 줄로, 넘겨 보면 무엇을 얻는지 말한다 (22자 이내, 예: "넘기면 원인 5가지가 나와요").
- cta: 마지막 장 문구 (16자 이내, 저장이나 친구 태그를 유도).
- caption: 300자 이내. 공감 가는 첫 줄 → 무엇을 알려 주는지 → 저장 권유 → 친구 태그 유도 순서. 마지막 줄은 "🐝 ${CONFIG.mascot}가 알려 주는 꿀팁".
- hashtags: 한국어 해시태그 6개를 공백으로 구분. name: 관리용 제목 (20자 이내).

- 주제를 직접 고를 때는 아래 [지금 시기]에 맞는 것을 먼저 고려하라. 단, 시기는 주제를 고르는 데만 쓴다. 뉴스에 나온 숫자·날짜·사건·사람 이름은 쓰지 말고, 정치·사건사고·연예·스포츠는 다루지 마라.

${await timelyNote()}

[요즘 뜨는 주제]
${trendTitles.map((t) => `- ${t}`).join("\n") || "- (없음)"}

JSON으로만 답하라: {"name":"","hook":"","hook_alts":["",""],"sub":"","cover_photo":"","slides":[{"title":"","body":"","photo":"","site":"","url":""}],"cta":"","caption":"","hashtags":""}`;
  const script = normalizeScript(await askGemini(prompt), 7);
  if (script.slides.length < 3) throw new Error("카드뉴스 형식 오류: 내용이 3장보다 적습니다");
  if (!sites) script.caption = withSites(script.caption, script.slides);   // 사이트 추천은 주소 확인을 마친 뒤에 목록을 붙임
  return script;
}

// 소개한 사이트를 캡션 첫 줄 바로 아래에 정리 ("더 보기"를 누르면 바로 보이게).
// 인스타 캡션의 주소는 눌러지지 않으므로, 따라 치기 쉽게 짧은 주소로 적음
const shortUrl = (url) => url.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "");
function withSites(caption, slides) {
  const sites = [...new Set(slides.filter((x) => x.url).map((x) => `${x.site ? `${x.site} 👉 ` : ""}${shortUrl(x.url)}`))].map((line, i) => `${i + 1}. ${line}`);
  if (!sites.length) return caption;
  const m = caption.match(/^(.+?(?:[?!.]|\n|$))\s*([\s\S]*)$/);
  // 링크 페이지가 켜져 있으면 "프로필 링크에서 눌러서 이동"을 먼저 안내
  const guide = linksEnabled() ? "🔗 프로필 링크를 누르면 아래 사이트로 바로 갈 수 있어요\n\n" : "";
  return [m[1].trim(), `${guide}📌 사이트 주소${linksEnabled() ? "" : " (주소창에 그대로 입력하세요)"}\n${sites.join("\n")}`, m[2].trim()].filter(Boolean).join("\n\n");
}

// 프로필 링크 페이지 새로 만들기: 발행한 게시물 중 사이트를 소개한 것을 최신순으로 실음
export async function refreshLinks() {
  if (!linksEnabled()) return null;
  const posts = (await loadDb()).filter((t) => t.status === "posted" && t.script?.slides?.some((s) => okUrl(s.url)))
    .sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)))
    .map((t) => ({ title: t.script.hook, date: t.posted_at, cover: t.cover_url, permalink: t.permalink,
      links: t.script.slides.filter((s) => okUrl(s.url)).map((s) => ({ name: s.site || s.title, url: s.url })) }));
  const r = await publishLinks(posts, { handle: CONFIG.handle, mascot: CONFIG.mascot, notice: CONFIG.affiliateNotice });
  log(`링크 페이지 ${r.changed ? "갱신" : "변경 없음"} (게시물 ${posts.length}건): ${r.url}`);
  return r;
}
export { linksUrl, linksEnabled };

// ── "이번 주 소식" 카드뉴스: 할인·팝업·축제·공연처럼 지금 알아야 이득인 소식 ──
// 구글 뉴스 공개 피드에서 최근 4일 기사 제목을 모음 (열쇠 없이 무료). 본문은 읽지 않고 제목·매체·날짜만 씀
async function newsHeadlines() {
  const queries = ["할인 행사", "세일 시작 최대", "팝업스토어 오픈", "축제 OR 전시 OR 공연 이번 주말", "무료 입장 OR 무료 이벤트"];
  const text = (s) => String(s ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  const seen = new Set(), out = [];
  for (const q of queries) {
    try {
      const xml = await (await fetch(`https://news.google.com/rss/search?${new URLSearchParams({ q: `${q} when:4d`, hl: "ko", gl: "KR", ceid: "KR:ko" })}`, { signal: AbortSignal.timeout(20_000) })).text();
      let n = 0;
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const source = text(m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]);
        const title = text(m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1]).replace(new RegExp(`\\s*[-|]\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`), "");
        const key = title.replace(/\s/g, "").slice(0, 18);
        if (!title || seen.has(key) || !/[가-힣]/.test(title)) continue;
        seen.add(key);
        out.push({ title, source, date: text(m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]).slice(5, 11), link: text(m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1]) });
        if (++n >= 12) break;
      }
    } catch (e) { log(`뉴스 피드 실패(${q}): ${e.message.slice(0, 80)}`); }
  }
  return out;
}

// 공연·축제 공식 자료 (열쇠가 있을 때만). 뉴스 제목과 달리 기간과 장소가 정확함
//   KOPIS_KEY     공연예술통합전산망(kopis.or.kr): 이번 주 예매 순위 상위 공연
//   TOUR_API_KEY  한국관광공사 관광정보(공공데이터포털 data.go.kr): 지금 열리고 있거나 곧 시작하는 축제·행사
async function officialEvents() {
  const out = [];
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const nice = (s) => String(s ?? "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3");
  const now = new Date();
  if (has("KOPIS_KEY")) {
    try {
      const xml = await (await fetch(`http://www.kopis.or.kr/openApi/restful/boxoffice?${new URLSearchParams({ service: env("KOPIS_KEY"), ststype: "week", date: ymd(new Date(now - 864e5)) })}`,
        { signal: AbortSignal.timeout(20_000) })).text();
      const rows = [...xml.matchAll(/<boxof>([\s\S]*?)<\/boxof>/g)].map((m) => (tag) => (m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").trim());
      for (const t of rows.slice(0, 10)) out.push({ title: `${t("prfnm")} (${t("cate")})`, source: `KOPIS 주간 예매 ${t("rnum")}위`, date: t("prfpd"), place: `${t("area")} ${t("prfplcnm")}`.trim(), link: "", official: true });
      if (!rows.length) log(`공연 자료를 읽지 못했습니다: ${xml.replace(/\s+/g, " ").slice(0, 120)}`);
    } catch (e) { log(`공연 자료 실패: ${e.message.slice(0, 100)}`); }
  }
  if (has("TOUR_API_KEY")) {
    for (const svc of ["KorService2/searchFestival2", "KorService1/searchFestival1"]) {       // 새 주소가 안 되면 예전 주소로
      try {
        const d = await getJson(`https://apis.data.go.kr/B551011/${svc}?${new URLSearchParams({ serviceKey: env("TOUR_API_KEY"), MobileOS: "ETC", MobileApp: "cardnews", _type: "json",
          eventStartDate: ymd(new Date(now - 30 * 864e5)), numOfRows: "200", pageNo: "1" })}`, { signal: AbortSignal.timeout(30_000) });
        const rows = [d.response?.body?.items?.item ?? []].flat();
        const today = ymd(now), soon = ymd(new Date(now.getTime() + 7 * 864e5));
        const live = rows.filter((r) => r.eventstartdate <= soon && r.eventenddate >= today);           // 지금 열리고 있거나 일주일 안에 시작
        for (const r of live.slice(0, 25)) out.push({ title: r.title, source: "한국관광공사", date: `${nice(r.eventstartdate)}~${nice(r.eventenddate)}`, place: String(r.addr1 ?? "").split(" ").slice(0, 2).join(" "), link: "", official: true });
        if (rows.length) break;
      } catch (e) { log(`축제 자료 실패(${svc.split("/")[0]}): ${e.message.slice(0, 100)}`); }
    }
  }
  if (out.length) log(`공식 자료 ${out.length}건 (공연 ${out.filter((x) => x.source.startsWith("KOPIS")).length}, 축제 ${out.filter((x) => x.source === "한국관광공사").length})`);
  return out;
}
// 관리 화면의 "열쇠 시험": 공연·축제 자료가 실제로 읽히는지 확인
export async function testEvents() {
  const rows = await officialEvents();
  const shows = rows.filter((x) => x.source.startsWith("KOPIS")), fests = rows.filter((x) => x.source === "한국관광공사");
  const line = (name, key, list) => !has(key) ? `${name}: 열쇠가 없습니다` : list.length ? `${name}: ${list.length}건 읽음 (예: ${list[0].title} · ${list[0].date})` : `${name}: 열쇠는 있지만 자료를 읽지 못했습니다. 열쇠가 맞는지, 발급 직후라면 1~2시간 뒤에 다시 시험해 보세요`;
  return { ok: true, message: `${line("공연(KOPIS)", "KOPIS_KEY", shows)}\n${line("축제(관광공사)", "TOUR_API_KEY", fests)}` };
}

// 반환: { script, refs: 근거 기사 [{title, source, link}] } 또는 { skip, reason }
export async function writeNews() {
  const items = [...await newsHeadlines(), ...await officialEvents()];
  if (items.length < 8) return { skip: true, reason: "뉴스 제목을 충분히 모으지 못했습니다" };
  const d = new Date();
  const prompt = `너는 한국 인스타그램 계정 "세바꿀(세상을 바꾸는 꿀팁)"의 카드뉴스 작가다. 이 계정을 팔로우만 해도 "지금 알아야 이득인 소식"을 놓치지 않게 해 주는 것이 목표다.
아래 [기사 제목]은 최근 4일 사이 한국 뉴스의 제목이다 (번호, 날짜, 매체). 오늘은 ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일이다.
이 가운데 "이번 주에 알아 두면 이득인 소식" 5개를 골라 카드뉴스 1편을 써라.

고르는 기준:
- 전국 어디서나 또는 온라인으로 누구나 누릴 수 있는 큰 할인·세일, 화제가 될 만한 팝업스토어, 주말에 가 볼 만한 큰 축제·전시·공연, 누구나 받을 수 있는 무료 혜택.
- 20~40대가 "어, 이건 알아 둬야지" 할 만한 것. 유명한 브랜드·장소일수록 좋다. 쇼핑·먹거리·나들이·문화생활을 먼저 고르고, 게임 아이템 지급 같은 소식은 고르지 마라.
- 고르지 말 것: 한 지역 주민만 해당하는 작은 행사나 지자체 쇼핑몰, 해외 행사, 기업 간 거래, 투자·주식·부동산, 정치·사건사고, 술·담배·도박·의약품, 이미 끝난 행사.
- 종류를 섞어라 (할인만 5개 말고 팝업·행사도).

쓰는 규칙:
- 기사 제목에 나온 사실만 써라. 제목에 없는 날짜·할인율·장소·조건을 지어내지 마라. 제목에 기간이 없으면 기간을 말하지 마라.
- 매체가 "KOPIS"나 "한국관광공사"인 항목은 공식 자료다. 거기 적힌 기간과 장소는 그대로 써도 된다. 공연은 "지금 예매 순위 ○위"라는 점을 살려라.
- slides의 각 장: no는 고른 기사의 번호. title은 무엇인지 한눈에 (브랜드·행사 이름 포함, 16자 이내). body는 제목에서 확인되는 내용을 1~2문장으로 풀어 쓰고, 마지막에 "자세한 기간과 조건은 공식 채널에서 확인하세요"를 붙인다.
- photo: 그 장에 넣을 사진 검색어. 브랜드 로고가 아니라 관련된 사물·장소를 영어 명사로, 쉼표로 2~3개 (예: "shopping bags, shopping mall", "festival lights, night market").
- cover_photo: 표지 배경 사진 검색어 (같은 방식).
${await hookRules()}
- hook은 표지 제목이다 (18자 이내). 소식 5개를 모두 아우르는 말이어야 한다. 소식 하나만 가리키거나, 소식에 없는 주장("미리 사면 손해")을 하면 안 된다. "이번 주"라는 시기가 느껴지게 써라 (예: "이번 주 놓치면 아까운 5가지", "이번 주말 갈 곳 정해 드림"). sub는 표지 아래 한 줄 (22자 이내, 예: "${d.getMonth() + 1}월 ${Math.ceil(d.getDate() / 7)}째 주 소식 5가지").
- cta: 마지막 장 문구 (16자 이내, 저장이나 같이 갈 친구 태그를 유도).
- caption: 첫 줄은 궁금하게 만드는 한 문장. 이어서 소식 5개를 번호와 함께 한 줄씩. 그다음 줄에 "기간과 조건은 바뀔 수 있어요. 가기 전에 공식 채널에서 꼭 확인하세요." 마지막 줄은 "🐝 ${CONFIG.mascot}가 알려 주는 이번 주 소식".
- hashtags: 한국어 해시태그 6개를 공백으로 구분. name: 관리용 제목 (20자 이내).
- 고를 만한 소식이 3개보다 적으면 {"skip": true, "reason": "이유"}만 답하라.

[기사 제목]
${items.map((it, i) => `${i + 1}. (${it.official ? `기간 ${it.date}` : it.date}, ${it.source}) ${it.title}${it.place ? ` — 장소: ${it.place}` : ""}`).join("\n")}

JSON으로만 답하라: {"name":"","hook":"","hook_alts":["",""],"sub":"","cover_photo":"","slides":[{"no":0,"title":"","body":"","photo":""}],"cta":"","caption":"","hashtags":""}`;
  const raw = await askGemini(prompt, { temperature: 0.6 });
  if (raw.skip) return { skip: true, reason: String(raw.reason ?? "고를 만한 소식이 없음") };
  const rows = (Array.isArray(raw.slides) ? raw.slides : []).filter((x) => items[Number(x?.no) - 1]);
  const refs = rows.map((x) => items[Number(x.no) - 1]);
  const script = normalizeScript({ ...raw, slides: rows }, 6);
  if (script.slides.length < 3 || script.slides.length !== refs.length) return { skip: true, reason: "소식을 3개 이상 고르지 못했습니다" };
  script.caption = `${script.caption}\n\n출처: ${[...new Set(refs.map((r) => r.source))].join(", ")}`;
  return { script, refs };
}

export function normalizeScript(d, max = 5) {
  const s = (v) => String(v ?? "").trim();
  const opt = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));   // 값이 있는 항목만 남김
  const slides = (Array.isArray(d?.slides) ? d.slides : [])
    .map((x) => ({ title: s(x?.title), body: s(x?.body), keyword: s(x?.keyword), ...opt({ shoot: s(x?.shoot), alt: s(x?.alt), site: s(x?.site), url: s(x?.url), shot: s(x?.shot), photo: s(x?.photo) }) }))
    .filter((x) => x.title && x.body).slice(0, max);
  if (!s(d?.hook) || !slides.length) throw new Error("대본 형식 오류: 첫 문구와 팁(제목·설명) 1개 이상이 필요합니다");
  const hashtags = s(d.hashtags).split(/\s+/).filter((t) => !t.includes("내돈내산")).join(" ");   // 확인되지 않은 "내돈내산" 표시는 자동으로 뺌
  const alts = (Array.isArray(d?.hook_alts) ? d.hook_alts : []).map(s).filter((h) => h && h !== s(d.hook)).slice(0, 3);   // 첫 문구의 다른 후보
  return { hook: s(d.hook), sub: s(d.sub), slides, cta: s(d.cta) || "저장해두고 써먹으세요", caption: s(d.caption), hashtags,
    ...opt({ product: s(d.product), name: s(d.name), items: s(d.items), hook_shoot: s(d.hook_shoot), cover_photo: s(d.cover_photo), cover_shot: s(d.cover_shot) }), ...(alts.length && { hook_alts: alts }) };
}

// ── 3. 장면 준비: 음성 합성 + 자막 타이밍 + 배경 영상 ──
function timeWords(text, seconds) {
  const parts = text.split(/\s+/).filter(Boolean);
  const total = parts.reduce((a, p) => a + p.length + 1, 0);
  const span = Math.max(0.5, seconds - 0.2) * 1000;
  let t = 50;
  return parts.map((p) => { const d = ((p.length + 1) / total) * span; const w = { text: p, startMs: Math.round(t), endMs: Math.round(t + d) }; t += d; return w; });
}

// 음성 도구가 준 낱말별 시각(marks)을 화면에 띄울 낱말(띄어쓰기 단위, 문장부호 포함)에 맞춤.
// 낱말 수가 서로 다를 수 있어(숫자·기호) 글자 수로 맞춰 가며 묶음. 맞추지 못하면 null → 글자 수 어림으로 대신함
function alignWords(text, marks) {
  const strip = (s) => s.replace(/[^\p{L}\p{N}]/gu, "");
  const out = [];
  let k = 0;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const need = strip(token).length;
    let got = 0, start = null, end = null;
    while (k < marks.length && got < Math.max(1, need)) { const m = marks[k++]; got += strip(m.text).length || 1; start ??= m.startMs; end = m.endMs; }
    if (start == null) return null;
    out.push({ text: token, startMs: Math.round(start), endMs: Math.round(end) });
  }
  if (k < marks.length - 1) return null;                         // 음성 쪽 낱말이 많이 남으면 잘못 맞춘 것
  for (let i = 0; i < out.length - 1; i++) out[i].endMs = out[i + 1].startMs;   // 다음 낱말이 시작할 때까지 강조 유지
  return out;
}

// Pexels 무료 스톡 영상 (PEXELS_API_KEY 있을 때만). 실패하면 그래픽 배경으로 대체
// 후보 영상의 대표 장면을 AI에게 보여 주고, 장면 내용과 맞는 것을 고르게 함.
// 반환: 고른 후보의 순서(0부터) / -1 = 맞는 것이 없음 / null = AI에게 물어보지 못함(그때는 첫 후보를 씀)
async function pickByLooking(thumbs, keyword, context, what = "배경 영상") {
  if (!has("GEMINI_API_KEY") || !context) return null;
  const shots = (await Promise.all(thumbs.map(async (url) => {
    if (!url) return null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      return res.ok ? { mime: "image/jpeg", data: Buffer.from(await res.arrayBuffer()).toString("base64") } : null;
    } catch { return null; }
  })));
  const shown = shots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);       // 사진을 받은 후보만
  if (!shown.length) return null;
  try {
    const d = await askGemini(`인스타그램 게시물의 한 장면에 넣을 ${what}을 고른다.
장면 내용: "${context}"
화면에 보여야 할 사물: "${keyword}"
아래 사진 ${shown.length}장은 후보의 모습이다 (순서대로 1번부터).
장면 내용과 같은 종류의 사물이나 장소가 화면에 분명히 보이는 후보의 번호를 하나 골라라.
내용과 상관없는 것(동물, 꽃, 공장, 술집, 풍경 등)이나 사람 얼굴이 크게 나오는 것은 고르지 마라.
그림·만화·합성처럼 보이는 것, 사물이 있어도 동물이나 캐릭터가 주인공인 것도 고르지 마라. 실제로 찍은 생활 장면만 고른다. 어울리는 것이 하나도 없으면 0.
JSON으로만 답하라: {"pick": 0}`, { images: shown.map((i) => shots[i]), rounds: 1, temperature: 0.2, fast: true });
    const pick = Number(d?.pick);
    return pick >= 1 && pick <= shown.length ? shown[pick - 1] : -1;
  } catch { return null; }
}

async function pixabayVideo(keyword, minSeconds, outFile, used, context) {
  const d = await getJson(`https://pixabay.com/api/videos/?${new URLSearchParams({ key: env("PIXABAY_API_KEY"), q: keyword, per_page: "40", safesearch: "true" })}`);
  // 검색어의 낱말이 영상 태그에 모두 들어 있는 것만 씀 (엉뚱한 영상이 깔리는 것을 막음. 없으면 그래픽 배경이 낫다)
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  const tagged = (v) => words.every((w) => String(v.tags ?? "").toLowerCase().includes(w));
  const hits = (d.hits ?? []).filter((v) => !used.has(`px${v.id}`) && v.duration >= minSeconds + 1 && tagged(v))
    .map((v) => ({ v, f: [v.videos?.medium, v.videos?.small, v.videos?.large].find((x) => x?.url && x.width >= 640) }))
    .filter((x) => x.f).sort((a, b) => (b.f.height > b.f.width) - (a.f.height > a.f.width)).slice(0, 6);   // 세로 영상 우선, 앞의 6개만 후보로
  if (!hits.length) return false;
  const pick = await pickByLooking(hits.map(({ v }) => v.videos?.medium?.thumbnail ?? v.videos?.small?.thumbnail ?? v.videos?.tiny?.thumbnail), keyword, context);
  if (pick === -1) { log(`배경 영상 후보 ${hits.length}개가 내용과 안 맞음(${keyword})`); return false; }
  if (pick > 0) hits.unshift(...hits.splice(pick, 1));         // AI가 고른 후보를 맨 앞으로
  for (const { v, f } of hits.slice(0, pick === null ? hits.length : 1)) {
    const res = await fetch(f.url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) continue;
    await fs.writeFile(outFile, Buffer.from(await res.arrayBuffer()));
    used.add(`px${v.id}`);
    return true;
  }
  return false;
}

// 카드뉴스에 넣을 무료 사진 (Pixabay). 태그가 검색어와 맞는 후보 중에서 AI가 직접 보고 고름.
// orientation: "horizontal"(내용 장) | "vertical"(표지). 맞는 사진이 없으면 false → 글만 들어감
async function stockPhoto(keyword, outFile, used, context, orientation = "horizontal") {
  if (!keyword || !has("PIXABAY_API_KEY")) return false;
  const search = async (q) => {
    const d = await getJson(`https://pixabay.com/api/?${new URLSearchParams({ key: env("PIXABAY_API_KEY"), q, image_type: "photo", orientation, per_page: "40", safesearch: "true" })}`);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = (d.hits ?? []).filter((h) => !used.has(`ph${h.id}`) && words.every((w) => String(h.tags ?? "").toLowerCase().includes(w))).slice(0, 8);
    if (!hits.length) return false;
    const pick = await pickByLooking(hits.map((h) => h.webformatURL), q, context, "사진");
    if (pick === -1) return false;
    const hit = hits[pick ?? 0];
    const res = await fetch(hit.largeImageURL ?? hit.webformatURL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return false;
    await fs.writeFile(outFile, Buffer.from(await res.arrayBuffer()));
    used.add(`ph${hit.id}`);
    return true;
  };
  try {
    // 검색어를 쉼표로 여러 개 적으면 앞에서부터 차례로 시도 (예: "coat, hanger, wardrobe")
    for (const alt of keyword.split(",").map((k) => k.trim()).filter(Boolean)) {
      if (await search(alt)) return true;
      const first = alt.split(/\s+/)[0];                       // 두 낱말로 못 찾으면 앞 낱말(구체적인 사물)만으로 한 번 더
      if (first !== alt && await search(first)) return true;
    }
    log(`맞는 사진 없음(${keyword}) — 글만 넣습니다`);
    return false;
  } catch (e) { log(`사진 찾기 실패(${keyword}): ${e.message.slice(0, 100)}`); return false; }
}

async function stockVideo(keyword, minSeconds, outFile, used, context) {
  if (!keyword) return false;
  if (has("PIXABAY_API_KEY")) {
    try {
      // 검색어를 쉼표로 여러 개 적으면 앞에서부터 차례로 시도 (예: "kitchen sink, sink, kitchen")
      for (const alt of keyword.split(",").map((k) => k.trim()).filter(Boolean)) {
        if (await pixabayVideo(alt, minSeconds, outFile, used, context)) return true;
        const first = alt.split(/\s+/)[0];                     // 두 낱말로 못 찾으면 앞 낱말(구체적인 사물)만으로 한 번 더
        if (first !== alt && await pixabayVideo(first, minSeconds, outFile, used, context)) return true;
      }
      log(`배경 영상 없음(${keyword}) — 그래픽 배경으로 대신합니다`);
    } catch (e) { log(`배경 영상 실패(Pixabay, ${keyword}): ${e.message}`); }
  }
  if (!has("PEXELS_API_KEY")) return false;
  try {
    const d = await getJson(`https://api.pexels.com/videos/search?${new URLSearchParams({ query: keyword, orientation: "portrait", per_page: "10" })}`,
      { headers: { Authorization: env("PEXELS_API_KEY") } });
    for (const v of d.videos ?? []) {
      if (used.has(v.id) || v.duration < minSeconds + 1) continue;
      const f = (v.video_files ?? []).filter((x) => x.file_type === "video/mp4" && x.height > x.width && x.width >= 720 && x.width <= 1080)
        .sort((a, b) => a.width - b.width)[0];
      if (!f) continue;
      const res = await fetch(f.link, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) continue;
      await fs.writeFile(outFile, Buffer.from(await res.arrayBuffer()));
      used.add(v.id);
      return true;
    }
  } catch (e) { log(`배경 영상 실패(${keyword}): ${e.message}`); }
  return false;
}

// clips: 직접 찍은 영상 { dir, files: { 장면번호: 파일명 } } — 있으면 스톡 영상 대신 그 영상을 배경으로 씀
async function buildScenes(script, job, clips) {
  const dir = path.join(ASSETS, job);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const plan = [
    { kind: "hook", text: [script.hook, script.sub].filter(Boolean).join(" "), keyword: script.slides[0]?.keyword },
    ...script.slides.map((s, i) => ({ kind: "tip", text: s.body, label: s.title, index: i + 1, keyword: s.keyword })),
    { kind: "cta", text: script.cta, keyword: "" },
  ];
  const used = new Set();
  const scenes = [];
  let synced = 0;
  for (const [i, p] of plan.entries()) {
    const voice = await synth(p.text, path.join(dir, `s${i}.mp3`));
    const clip = p.kind !== "cta" && clips?.files[i];
    const seconds = voice.seconds + (p.kind === "cta" ? 1.2 : clip ? 0.7 : 0.35);
    let bg = null, bgSeconds = null;
    if (clip) {
      const name = `b${i}${path.extname(clip)}`;
      await fs.copyFile(path.join(clips.dir, clip), path.join(dir, name));
      bg = `job/${job}/${name}`;
      bgSeconds = (await parseFile(path.join(dir, name)).catch(() => null))?.format.duration ?? null;
    } else if (!clips && await stockVideo(p.keyword, seconds, path.join(dir, `b${i}.mp4`), used, [p.label, p.text].filter(Boolean).join(" — "))) bg = `job/${job}/b${i}.mp4`;
    const exact = voice.marks && alignWords(p.text, voice.marks);         // 음성과 정확히 맞는 자막 시각
    if (exact) synced++;
    scenes.push({ kind: p.kind, label: p.label, index: p.index, words: exact ?? timeWords(p.text, voice.seconds), frames: Math.ceil(seconds * FPS),
      audio: voice.file ? `job/${job}/s${i}.mp3` : null, bg, own: Boolean(clip), light: Boolean(clips), bgSeconds });
  }
  log(`장면 ${scenes.length}개 준비 (음성 ${scenes.filter((s) => s.audio).length}, 자막 정확히 맞춤 ${synced}, 배경 영상 ${scenes.filter((s) => s.bg).length})`);
  return { dir, props: { scenes, handle: CONFIG.handle, mascot: CONFIG.mascot, bgm: existsSync(path.join(ROOT, "public", "bgm.mp3")) ? "bgm.mp3" : null } };
}

// ── 4. Remotion 렌더 (1080x1920) ──
export const BROWSER = process.env.BROWSER_PATH || [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",          // 맥
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/chromium",
].find(existsSync);
let serveUrlPromise;
let renderQueue = Promise.resolve();

export function render(script, name, clips) {
  const job = renderQueue.then(async () => {
    const jobId = `${name}-${Date.now().toString(36)}`.replace(/[^\w-]/g, "_");
    const { dir, props } = await buildScenes(script, jobId, clips);
    serveUrlPromise ??= bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), publicDir: path.join(ROOT, "public") });
    const serveUrl = await serveUrlPromise;
    const jobPublic = path.join(serveUrl, "public", "job", jobId);       // 번들 안으로 이번 작업의 음성·영상 복사
    await fs.cp(dir, jobPublic, { recursive: true });
    try {
      const browserExecutable = BROWSER ?? null;
      const composition = await selectComposition({ serveUrl, id: "Shorts", inputProps: props, browserExecutable });
      await fs.mkdir(OUT, { recursive: true });
      const file = `${jobId}.mp4`;
      log(`렌더 시작 ${name} (${(composition.durationInFrames / FPS).toFixed(0)}초)`);
      // crf 23: 화질은 충분하고 파일 크기는 절반쯤 (텔레그램 미리 보기와 발행 업로드가 빨라짐)
      await renderMedia({ composition, serveUrl, codec: "h264", audioCodec: "aac", crf: 23, outputLocation: path.join(OUT, file), inputProps: props, browserExecutable });
      log(`렌더 완료 ${file}`);
      return file;
    } finally {
      await fs.rm(jobPublic, { recursive: true, force: true });
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  renderQueue = job.catch(() => {});
  return job;
}

// ── 4-2. 카드뉴스 렌더 (1080x1350 이미지 여러 장) ──
// 사이트 화면 사진: 설치된 크롬으로 공식 사이트 첫 화면을 찍음. 실패하면 사진 없이 글만 넣음
// tall: 카드 한 장(4:5)을 꽉 채울 세로로 긴 화면으로 찍음
async function screenshot(url, outFile, tall = false) {
  if (!BROWSER || !/^https:\/\/[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/[^\s"'<>]*)?$/i.test(url)) return false;
  let browser;
  try {
    const { default: puppeteer } = await import("puppeteer-core");
    browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ["--mute-audio", "--hide-scrollbars", ...(process.platform === "linux" ? ["--no-sandbox"] : [])] });
    const page = await browser.newPage();
    await page.setViewport(tall ? { width: 1080, height: 1350 } : { width: 1280, height: 900 });
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 }).catch(() => null);   // 느린 사이트는 뜬 데까지만 찍음
    await sleep(1500);
    // 자동 접속을 막는 사이트(차단 안내 화면으로 넘어감)는 우회하지 않고 포기 → 사진으로 대신하거나 글만 넣음.
    // 오류 화면("페이지를 찾을 수 없습니다" 등)이 뜬 경우도 쓰지 않음
    const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    const blocked = (res && res.status() >= 400) || /restrict|mbuster|captcha|denied|blocked/i.test(page.url()) || text.length < 100
      || /찾을 수 없습니다|not found|접근이 (제한|차단)|접속이 (제한|차단)/i.test(text.slice(0, 800));
    if (blocked) return false;
    await page.evaluate(() => {              // 화면을 가리는 공지 팝업과 어두운 덮개를 숨김
      const vw = innerWidth, vh = innerHeight;
      for (const el of document.querySelectorAll("body *")) {
        const st = getComputedStyle(el);
        if (st.position !== "fixed" && st.position !== "absolute") continue;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.2 || r.height < vh * 0.15) continue;
        const named = /pop|modal|dimm|notice|overlay|layer/i.test(`${el.id} ${el.getAttribute("class") ?? ""}`) && (Number(st.zIndex) || 0) >= 1;
        const veil = st.position === "fixed" && r.width >= vw * 0.9 && r.height >= vh * 0.9
          && (parseFloat(st.opacity) < 1 || /rgba\(\d+, \d+, \d+, 0?\.\d+\)/.test(st.backgroundColor));
        if (named || veil) el.style.setProperty("display", "none", "important");
      }
      document.documentElement.style.overflow = document.body.style.overflow = "visible";
    }).catch(() => {});
    await page.screenshot({ path: outFile, type: "png" });
    // 너무 작으면 빈 화면으로 보고 버림. 장 전체를 채울 때는 기준을 높임 (한 가지 색뿐인 로딩 화면이 크게 들어가는 것을 막음)
    return (await fs.stat(outFile)).size > (tall ? 150_000 : 20_000);
  } catch { return false; }
  finally { await browser?.close().catch(() => {}); }
}

const shotDir = (code) => path.join(ROOT, "data", "shots", code.replace(/[^\w-]/g, "_"));

// 카드에 넣을 화면 사진을 직접 올림 → 저장한 파일 이름을 돌려줌 (관리 화면이 그 장의 shot에 적어 둠)
export async function saveShot(code, stream, filename = "") {
  const tip = (await loadDb()).find((t) => t.shortCode === code);
  if (tip?.type !== "card") throw new Error("카드뉴스를 찾을 수 없습니다");
  const ext = [".png", ".jpg", ".jpeg", ".webp"].find((e) => e === path.extname(filename).toLowerCase()) ?? ".png";
  await fs.mkdir(shotDir(code), { recursive: true });
  const file = `${Date.now().toString(36)}${ext}`;
  let size = 0;
  try {
    await pipeline(stream, async function* (src) {
      for await (const chunk of src) { size += chunk.length; if (size > 20e6) throw new Error("사진이 너무 큽니다 (20MB 이하)"); yield chunk; }
    }, createWriteStream(path.join(shotDir(code), file)));
    if (size < 1000) throw new Error("사진 파일이 비어 있습니다");
  } catch (e) { await fs.rm(path.join(shotDir(code), file), { force: true }); throw e; }
  return { file, size };
}

// full: 사이트 화면을 장 전체에 꽉 채우고 제목을 스티커처럼 얹는 모양 (사이트 추천용). 화면 사진이 없는 장은 보통 모양으로 나옴
export function renderCards(script, name, { full = false } = {}) {
  const job = renderQueue.then(async () => {
    const jobId = `${name}-${Date.now().toString(36)}`.replace(/[^\w-]/g, "_");
    serveUrlPromise ??= bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), publicDir: path.join(ROOT, "public") });
    const serveUrl = await serveUrlPromise;
    const jobPublic = path.join(serveUrl, "public", "job", jobId);
    await fs.mkdir(jobPublic, { recursive: true });
    await fs.mkdir(OUT, { recursive: true });
    try {
      const base = { handle: CONFIG.handle, mascot: CONFIG.mascot, total: script.slides.length };
      const used = new Set();
      // 표지 배경 사진: 세로 사진을 먼저 찾고, 없으면 가로 사진
      const coverKey = script.cover_photo || script.slides.find((s) => s.photo)?.photo;
      const coverContext = [script.hook, script.name].filter(Boolean).join(" — ");
      // 주인이 표지 사진을 직접 올렸으면 그것을 씀
      const ownCover = script.cover_shot ? path.join(shotDir(name), path.basename(script.cover_shot)) : null;
      const hasOwn = Boolean(ownCover && existsSync(ownCover));
      const coverName = hasOwn ? `cover${path.extname(ownCover)}` : "cover.jpg";
      if (hasOwn) await fs.copyFile(ownCover, path.join(jobPublic, coverName));
      const cover = hasOwn || (coverKey && (await stockPhoto(coverKey, path.join(jobPublic, "cover.jpg"), used, coverContext, "vertical")
        || await stockPhoto(coverKey, path.join(jobPublic, "cover.jpg"), used, coverContext, "horizontal")));
      const pages = [{ kind: "cover", title: script.hook, body: script.sub, photo: cover ? `job/${jobId}/${coverName}` : null }];
      let photos = cover ? 1 : 0;
      for (const [i, s] of script.slides.entries()) {
        let shot = false, photo = false;
        const own = s.shot && path.join(shotDir(name), path.basename(s.shot));       // 직접 올린 화면 사진이 있으면 그것을 씀
        const shotName = `shot${i}${own ? path.extname(own) : ".png"}`;
        if (own && existsSync(own)) { await fs.copyFile(own, path.join(jobPublic, shotName)); shot = true; }
        else if (s.url) {
          shot = await screenshot(s.url, path.join(jobPublic, shotName), full);
          if (!shot) log(`사이트 화면을 자동으로 못 찍었습니다 (${s.url}) — 글만 넣습니다. 직접 찍은 사진을 올릴 수 있습니다`);
        }
        // 사이트 화면이 없는 장에는 내용에 맞는 사진을 넣음
        if (!shot && s.photo) photo = await stockPhoto(s.photo, path.join(jobPublic, `photo${i}.jpg`), used, `${s.title} — ${s.body}`);
        if (shot || photo) photos++;
        pages.push({ kind: "card", index: i + 1, title: s.title, body: s.body, shot: shot ? `job/${jobId}/${shotName}` : null,
          photo: photo ? `job/${jobId}/photo${i}.jpg` : null, full: full && Boolean(shot),
          site: [s.site, s.url && shortUrl(s.url)].filter(Boolean).join(" · ") });      // 카드에도 주소를 적어 보고 따라 칠 수 있게
      }
      pages.push({ kind: "end", title: script.cta });
      const browserExecutable = BROWSER ?? null;
      const composition = await selectComposition({ serveUrl, id: "Card", inputProps: { ...base, ...pages[0] }, browserExecutable });
      log(`카드뉴스 렌더 시작 ${name} (${pages.length}장, 사진·화면 ${photos}장)`);
      const files = [];
      for (const [n, page] of pages.entries()) {
        const inputProps = { ...base, ...page };
        const file = `${jobId}-${n + 1}.jpg`;
        await renderStill({ composition: { ...composition, props: inputProps }, serveUrl, inputProps, output: path.join(OUT, file),
          imageFormat: "jpeg", jpegQuality: 92, browserExecutable });
        files.push(file);
      }
      log(`카드뉴스 렌더 완료 ${files.length}장`);
      return files;
    } finally { await fs.rm(jobPublic, { recursive: true, force: true }); }
  });
  renderQueue = job.catch(() => {});
  return job;
}

// ── 5. 업로드 + 발행 ──
export async function upload(file, kind = "video") {
  const form = new FormData();
  form.append("file", new Blob([await fs.readFile(path.join(OUT, file))]), file);
  form.append("upload_preset", env("CLOUDINARY_PRESET"));
  return (await getJson(`https://api.cloudinary.com/v1_1/${env("CLOUDINARY_CLOUD")}/${kind}/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(300_000) })).secure_url;
}

// 카드뉴스(이미지 여러 장) 발행
export async function publishCarousel(imageUrls, caption) {
  const host = env("IG_ACCESS_TOKEN").startsWith("IG") ? "graph.instagram.com" : "graph.facebook.com";
  const G = `https://${host}/${process.env.GRAPH_VERSION ?? "v21.0"}`;
  const q = (o) => new URLSearchParams({ ...o, access_token: env("IG_ACCESS_TOKEN") });
  const post = async (pathname, o) => (await fetch(`${G}/${pathname}?${q(o)}`, { method: "POST" })).json();
  const children = [];
  for (const image_url of imageUrls) {
    const c = await post(`${env("IG_USER_ID")}/media`, { image_url, is_carousel_item: "true" });
    if (!c.id) throw new Error(`이미지 등록 실패: ${JSON.stringify(c)}`);
    children.push(c.id);
  }
  const c = await post(`${env("IG_USER_ID")}/media`, { media_type: "CAROUSEL", children: children.join(","), caption });
  if (!c.id) throw new Error(`카드뉴스 묶음 생성 실패: ${JSON.stringify(c)}`);
  for (let i = 0; i < 12; i++) {             // 인스타 쪽 처리 대기 (최대 1분)
    const s = await (await fetch(`${G}/${c.id}?${q({ fields: "status_code,status" })}`)).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error(`인스타 이미지 처리 실패: ${JSON.stringify(s)}`);
    await sleep(5_000);
  }
  const p = await post(`${env("IG_USER_ID")}/media_publish`, { creation_id: c.id });
  if (!p.id) throw new Error(`발행 실패: ${JSON.stringify(p)}`);
  return p.id;
}

export async function publishReel(videoUrl, caption) {
  // 인스타그램 로그인으로 받은 토큰(IG로 시작)은 graph.instagram.com, 페이스북 로그인 토큰은 graph.facebook.com
  const host = env("IG_ACCESS_TOKEN").startsWith("IG") ? "graph.instagram.com" : "graph.facebook.com";
  const G = `https://${host}/${process.env.GRAPH_VERSION ?? "v21.0"}`;
  const q = (o) => new URLSearchParams({ ...o, access_token: env("IG_ACCESS_TOKEN") });
  const c = await (await fetch(`${G}/${env("IG_USER_ID")}/media?${q({ media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true", thumb_offset: "800" })}`, { method: "POST" })).json();
  if (!c.id) throw new Error(`컨테이너 생성 실패: ${JSON.stringify(c)}`);
  for (let i = 0; ; i++) {                 // 인스타 쪽 영상 처리 대기 (최대 5분)
    await sleep(10_000);
    const s = await (await fetch(`${G}/${c.id}?${q({ fields: "status_code,status" })}`)).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || i >= 30) throw new Error(`인스타 영상 처리 실패: ${JSON.stringify(s)}`);
  }
  const p = await (await fetch(`${G}/${env("IG_USER_ID")}/media_publish?${q({ creation_id: c.id })}`, { method: "POST" })).json();
  if (!p.id) throw new Error(`발행 실패: ${JSON.stringify(p)}`);
  return p.id;
}

// ── 상태 흐름: new → working → pending(승인 대기) → working → posted / rejected / skipped / error ──
export async function produce(code, editedScript) {
  const db = await loadDb();
  const tip = db.find((t) => t.shortCode === code);
  if (!tip) throw new Error("소재를 찾을 수 없습니다");
  if (tip.type === "shoot") return produceShoot(tip, editedScript);
  if (tip.type === "card") return produceCard(tip, editedScript);
  await patchTip(code, { status: "working", error: null });
  try {
    let script, checks = [], fixed = [];
    if (editedScript) script = normalizeScript(editedScript);
    else {
      const trends = db.filter((t) => t.shortCode !== code && t.status === "new").slice(-6).map((t) => t.tip_text.split("\n")[0].slice(0, 80));
      script = await writeScript(tip, trends);
      if (script.skip) { log(`건너뜀 ${code}: ${script.reason}`); return patchTip(code, { status: "skipped", error: script.reason }); }
      ({ script, checks, fixed } = await polish(script));       // AI 초안은 검수를 한 번 거침
    }
    const video = await render(script, code);
    if (tip.video && tip.video !== video) await fs.rm(path.join(OUT, tip.video), { force: true });
    await patchTip(code, { status: "pending", script, video, checks, fixed, rendered_at: new Date().toISOString() });
  } catch (e) {
    log(`오류 ${code}: ${e.message}`);
    await patchTip(code, { status: "error", error: e.message });
  }
}

// ── 직접 촬영 흐름: 기획(shoot, 촬영 대기) → 장면별 영상 올리기 → 영상 만들기 → pending(승인 대기) ──
const clipDir = (code) => path.join(CLIPS, code.replace(/[^\w-]/g, "_"));
const sceneNumbers = (script) => [0, ...script.slides.map((_, i) => i + 1)];   // 0 = 첫 화면

async function shootCandidates() {
  const db = await loadDb();
  const made = db.filter((t) => t.type !== "shoot" && t.script && ["posted", "pending"].includes(t.status)).slice(-8)
    .map((t) => `${t.script.hook} (${t.script.slides.map((x) => x.title).join(", ")})`);
  const trends = db.filter((t) => t.type !== "shoot" && t.status === "new").slice(-8).map((t) => t.tip_text.split("\n")[0].slice(0, 80));
  return { ideas: [...made, ...trends], taken: db.filter((t) => t.type === "shoot" && t.script?.name).map((t) => t.script.name) };
}

export async function planShootItem(topic = "", format = "auto") {
  const code = `shoot-${Date.now().toString(36)}`;
  await updateDb((db) => db.push({ shortCode: code, type: "shoot", source: "shoot", url: "", owner: "직접 촬영", views: 0, likes: 0, comments: 0, score: 0,
    topic, format, tip_text: topic || "(AI가 고른 주제)", status: "working", collected_at: new Date().toISOString() }));
  await produceShoot({ shortCode: code, topic, format });
  return code;
}

async function produceShoot(tip, editedScript) {
  const code = tip.shortCode;
  await patchTip(code, { status: "working", error: null });
  try {
    if (!editedScript) {                         // 기획 새로 쓰기
      log(`촬영 기획 작성 ${code}`);
      const script = await planShoot(tip.topic, tip.format, await shootCandidates());
      log(`촬영 기획 완료: ${script.name}`);
      return await patchTip(code, { status: "shoot", script, tip_text: tip.topic || script.name, planned_at: new Date().toISOString() });
    }
    const script = normalizeScript(editedScript);
    const files = Object.fromEntries(Object.entries(tip.clips ?? {}).map(([n, c]) => [n, c.file]));
    const missing = sceneNumbers(script).filter((n) => !files[n]);
    if (missing.length) throw new Error(`아직 영상을 올리지 않은 장면: ${missing.map((n) => (n ? `${n}번` : "첫 화면")).join(", ")}`);
    const video = await render(script, code, { dir: clipDir(code), files });
    if (tip.video && tip.video !== video) await fs.rm(path.join(OUT, tip.video), { force: true });
    await patchTip(code, { status: "pending", script, video, rendered_at: new Date().toISOString() });
  } catch (e) {
    log(`오류 ${code}: ${e.message}`);
    await patchTip(code, { status: tip.script ? "shoot" : "error", error: e.message });
  }
}

// ── 카드뉴스 흐름: 주제 → 대본 → 이미지 여러 장 → pending(승인 대기) ──
// script를 함께 주면 AI에게 새로 쓰게 하지 않고 그 대본으로 바로 만듦
// kind: "" 보통 꿀팁 카드뉴스 | "news" 이번 주 소식(할인·팝업·행사) | "sites" 트렌디한 사이트 추천
export async function planCardItem(topic = "", label = "", script = null, kind = "") {
  const code = `card-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const name = label || topic || { news: "이번 주 소식", sites: "트렌디한 사이트 추천" }[kind] || "(AI가 고른 주제)";
  await updateDb((db) => db.push({ shortCode: code, type: "card", kind, source: "card", url: "", owner: "카드뉴스", views: 0, likes: 0, comments: 0, score: 0,
    topic, tip_text: name, status: "working", collected_at: new Date().toISOString() }));
  await produceCard({ shortCode: code, topic, kind }, script);
  return code;
}

// 사이트 추천 카드뉴스에 쓸 수 있는 곳. AI에게 맡기면 없는 사이트나 틀린 이름을 지어내서(2026-11-12에 확인),
// 여기 있는 곳에서만 고르게 함. 새로 소개하고 싶은 곳은 이 목록에 추가 (이름, 주소, 무엇을 하는 곳인지)
const SITE_POOL = [
  ["Neal.fun", "https://neal.fun", "클릭하며 노는 기발한 놀이 페이지 모음. 영어지만 글을 몰라도 즐길 수 있다"],
  ["WindowSwap", "https://www.window-swap.com", "세계 여러 나라 사람들의 집 창밖 풍경 영상을 무작위로 보여 준다"],
  ["Radio Garden", "https://radio.garden", "지구본을 돌려 전 세계 라디오 방송을 실시간으로 듣는다"],
  ["A Soft Murmur", "https://asoftmurmur.com", "빗소리, 모닥불, 파도 같은 소리를 섞어 나만의 배경 소리를 만든다"],
  ["Pomofocus", "https://pomofocus.io", "25분 집중하고 5분 쉬는 뽀모도로 타이머. 설치 없이 바로 쓴다"],
  ["Color Hunt", "https://colorhunt.co", "어울리는 색 네 가지를 묶은 색 조합을 골라 볼 수 있다"],
  ["눈누", "https://noonnu.cc", "상업적으로 써도 되는 무료 한글 글꼴을 모아 보여 준다"],
  ["Unsplash", "https://unsplash.com", "무료로 쓸 수 있는 고화질 사진을 찾는다"],
  ["Pixabay", "https://pixabay.com", "무료 사진, 영상, 음악을 찾는다"],
  ["remove.bg", "https://www.remove.bg", "사진을 올리면 배경을 자동으로 지워 준다"],
  ["Photopea", "https://www.photopea.com", "설치 없이 브라우저에서 쓰는 무료 사진 편집기"],
  ["TinyPNG", "https://tinypng.com", "사진을 올리면 화질은 거의 그대로 두고 용량을 줄여 준다"],
  ["iLovePDF", "https://www.ilovepdf.com", "PDF를 합치고, 나누고, 다른 형식으로 바꾼다"],
  ["Flightradar24", "https://www.flightradar24.com", "지금 하늘에 떠 있는 비행기를 지도에서 실시간으로 본다"],
  ["earth.nullschool", "https://earth.nullschool.net", "전 세계 바람과 날씨의 흐름을 움직이는 지구본으로 본다"],
  ["Google Arts & Culture", "https://artsandculture.google.com", "전 세계 미술관의 작품을 집에서 크게 확대해 감상한다"],
  ["Monkeytype", "https://monkeytype.com", "깔끔한 화면에서 타자 속도를 재고 연습한다"],
  ["MuscleWiki", "https://musclewiki.com", "몸 그림에서 근육 부위를 누르면 그 부위 운동법을 보여 준다"],
  ["대한민국 구석구석", "https://korean.visitkorea.or.kr", "한국관광공사가 운영하는 국내 여행지·축제 안내"],
  ["문화포털", "https://www.culture.go.kr", "전국의 공연·전시·문화 행사 소식을 모아 보여 준다"],
].map(([site, url, what]) => ({ site, url, what }));
// ── 요즘 뜨는 사이트 찾기: 유튜브에서 최근 "사이트 추천" 영상을 찾아 설명란에 적힌 사이트를 모음 ──
// 사이트마다 실제로 열어 제목·설명을 읽고, AI가 쓸 만한 곳만 골라 data/sites.json에 쌓음 (한 번 본 곳은 다시 보지 않음)
const SITES_FILE = path.join(ROOT, "data", "sites.json");
const loadSites = async () => { try { return JSON.parse(await fs.readFile(SITES_FILE, "utf8")); } catch { return []; } };
const NOT_A_SITE = /youtu\.?be|instagram|facebook|tiktok|twitter|\/\/x\.com|naver\.(com|me)|kakao|coupang|bit\.ly|vo\.la|han\.gl|me2\.do|linktr|litt\.ly|forms\.gle|smartstore|tistory|blog|notion\.site|discord|\/\/t\.me|apple\.com|play\.google|amzn|amazon|aliexpress|toss\.|github\.|microsoft\.com|google\.com|sooplive|twitch|chzzk/i;
export async function discoverSites() {
  if (!has("YOUTUBE_API_KEY")) return 0;
  const yt = (p, params) => getJson(`https://www.googleapis.com/youtube/v3/${p}?${new URLSearchParams({ ...params, key: env("YOUTUBE_API_KEY") })}`);
  const after = new Date(Date.now() - 45 * 864e5).toISOString();
  const ids = new Set();
  for (const q of ["유용한 사이트 추천", "신기한 사이트", "무료 사이트 추천", "꿀사이트 추천", "잼컨 사이트", "심심할 때 하기 좋은 사이트", "친구랑 하기 좋은 사이트"]) {
    const s = await yt("search", { part: "id", q, type: "video", order: "viewCount", publishedAfter: after, regionCode: "KR", relevanceLanguage: "ko", maxResults: "12" });
    for (const it of s.items ?? []) if (it.id?.videoId) ids.add(it.id.videoId);
  }
  if (!ids.size) return 0;
  const vids = await yt("videos", { part: "snippet,statistics", id: [...ids].slice(0, 50).join(",") });
  const saved = await loadSites();
  const known = new Set([...SITE_POOL.map((p) => new URL(p.url).hostname.replace(/^www\./, "")), ...saved.map((x) => x.host)]);
  const found = new Map();                                   // host → { url, views, from }
  for (const v of vids.items ?? []) {
    const views = Number(v.statistics?.viewCount ?? 0);
    for (const m of (v.snippet.description ?? "").matchAll(/https?:\/\/[^\s)>\]"'，]+/g)) {
      let u; try { u = new URL(m[0]); } catch { continue; }
      const host = u.hostname.replace(/^www\./, "");
      if (NOT_A_SITE.test(u.href) || known.has(host)) continue;
      const cur = found.get(host);
      if (!cur || views > cur.views) found.set(host, { host, url: `https://${u.hostname}`, views, from: v.snippet.title.slice(0, 70) });
    }
  }
  // 조회수 높은 영상에 나온 곳부터 15곳까지, 실제로 열어 제목과 설명을 읽음
  const cands = [];
  for (const c of [...found.values()].sort((a, b) => b.views - a.views).slice(0, 15)) {
    try {
      const res = await fetch(c.url, { redirect: "follow", signal: AbortSignal.timeout(12_000), headers: { "Accept-Language": "ko,en" } });
      if (!res.ok) continue;
      const html = (await res.text()).slice(0, 150_000);
      const pick = (re) => (html.match(re)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      const title = pick(/<title[^>]*>([^<]*)<\/title>/i);
      const desc = pick(/<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']*)["']/i) || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name=["']description["']|property=["']og:description["'])/i);
      if (title) cands.push({ ...c, title, desc });
    } catch { /* 안 열리는 곳은 건너뜀 */ }
  }
  if (!cands.length) return 0;
  const out = await askGemini(`너는 한국 인스타그램 계정 "세바꿀"의 자료 담당이다. 아래 [후보]는 최근 유튜브의 "사이트 추천" 영상 설명란에 적혀 있던 사이트들이다 (주소, 그 사이트의 제목과 설명, 소개한 영상 제목).
"요즘 20~30대가 좋아할 만한, 누구나 무료로 바로 써 볼 수 있는 쓸모 있거나 재미있는 사이트"로 카드뉴스에 소개해도 되는 곳만 골라라.

고르지 말 것: 특정 게임 전용 사이트(공략, 시세, 전적), 개발자만 쓰는 도구, 성인·도박·대출·코인·주식 종목 추천, 불법 스트리밍·다운로드, 쇼핑몰이나 상품 판매 페이지, 개인 블로그나 방송 채널, 돈을 내야만 쓸 수 있는 곳, 제목과 설명만으로는 무엇을 하는 곳인지 알 수 없는 곳.

후보마다 답할 것 (빠짐없이, 번호 그대로):
- ok: 소개해도 되면 true
- site: 사이트 이름 (사이트 제목에서 따온 짧은 이름)
- what: 무엇을 할 수 있는 곳인지 한국어 한 문장. 사이트의 제목·설명과 영상 제목에 나온 내용만 써라. 지어내지 마라.

[후보]
${cands.map((c, i) => `${i + 1}. ${c.url} | 제목: ${c.title} | 설명: ${c.desc || "(없음)"} | 소개한 영상: ${c.from}`).join("\n")}

JSON으로만 답하라: {"sites":[{"no":1,"ok":true,"site":"","what":""}]}`, { temperature: 0.2 });
  const now = new Date().toISOString();
  const judged = cands.map((c, i) => {
    const r = (out.sites ?? []).find((x) => Number(x.no) === i + 1) ?? {};
    return { host: c.host, url: c.url, ok: r.ok === true && Boolean(String(r.what ?? "").trim()), site: String(r.site ?? c.title).trim().slice(0, 30), what: String(r.what ?? "").trim(), from: c.from, views: c.views, added_at: now };
  });
  await fs.mkdir(path.dirname(SITES_FILE), { recursive: true });
  await fs.writeFile(SITES_FILE, JSON.stringify([...saved, ...judged], null, 2));
  const good = judged.filter((x) => x.ok);
  log(`요즘 뜨는 사이트: 새 후보 ${judged.length}곳 중 ${good.length}곳을 목록에 추가${good.length ? ` (${good.map((x) => x.site).join(", ")})` : ""}`);
  return good.length;
}

// ── 사이트 목록 관리 (관리 화면의 "사이트 목록") ──
const hostOf = (url) => new URL(url).hostname.replace(/^www\./, "");
// 사이트 추천에 쓸 수 있는 곳 전체. 주인이 뺀 곳은 제외
async function sitePool() {
  const saved = await loadSites();
  const removed = new Set(saved.filter((x) => x.removed).map((x) => x.host));
  const row = (tag) => (x) => ({ site: x.site, url: x.url, what: x.what, tag });
  return [...saved.filter((x) => x.ok && x.manual).reverse().map(row("직접 추가")), ...saved.filter((x) => x.ok && !x.manual).reverse().map(row("유튜브")), ...SITE_POOL.map(row("기본"))]
    .filter((p) => !removed.has(hostOf(p.url)));
}
export async function listSites() {
  const db = await loadDb();
  const used = new Set(db.filter((t) => t.type === "card" && ["approved", "posted"].includes(t.status)).flatMap((t) => t.script?.slides ?? []).map((s) => s.url).filter(Boolean));
  return (await sitePool()).map((p) => ({ ...p, used: used.has(p.url) }));
}
// 주소만 넣어도 됨: 실제로 열리는지 확인하고, 이름과 설명이 비어 있으면 사이트의 제목·설명에서 채움
export async function addSite({ url, site, what }) {
  let link = String(url ?? "").trim();
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  link = link.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
  if (!okUrl(link)) throw new Error("사이트 주소가 맞지 않습니다 (예: https://neal.fun)");
  const host = hostOf(link);
  if ((await sitePool()).some((p) => hostOf(p.url) === host)) throw new Error("이미 목록에 있는 사이트입니다");
  let title = "", desc = "";
  try {
    const res = await fetch(link, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "Accept-Language": "ko,en" } });
    if (res.status === 404 || res.status === 410) throw new Error("없는 페이지입니다");
    const html = res.ok ? (await res.text()).slice(0, 150_000) : "";         // 403 같은 자동 접속 차단은 실제로 있는 사이트이므로 통과
    const pick = (re) => (html.match(re)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    title = pick(/<title[^>]*>([^<]*)<\/title>/i);
    desc = pick(/<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']*)["']/i) || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name=["']description["']|property=["']og:description["'])/i);
  } catch (e) { throw new Error(`사이트가 열리지 않습니다 (${e.message.slice(0, 60)}). 주소를 다시 확인해 주세요`); }
  let name = String(site ?? "").trim().slice(0, 30), about = String(what ?? "").trim().slice(0, 200);
  if (!about && (title || desc)) {
    try {
      const out = await askGemini(`아래는 어떤 웹사이트의 제목과 설명이다. 이 사이트에서 무엇을 할 수 있는지 한국어 한 문장으로 써라. 제목과 설명에 나온 내용만 쓰고 지어내지 마라. 알 수 없으면 what을 빈 문자열로 두어라.
주소: ${link}\n제목: ${title}\n설명: ${desc || "(없음)"}\nJSON으로만 답하라: {"site":"사이트의 짧은 이름","what":""}`, { temperature: 0.2, fast: true, rounds: 1 });
      about = String(out?.what ?? "").trim().slice(0, 200);
      if (!name) name = String(out?.site ?? "").trim().slice(0, 30);
    } catch { /* AI가 안 되면 아래에서 직접 적어 달라고 함 */ }
  }
  if (!name) name = title.split(/[|\-–—:·]/)[0].trim().slice(0, 30) || host;
  if (!about) throw new Error("이 사이트가 무엇을 하는 곳인지 알아내지 못했습니다. '어떤 곳인지' 칸에 한 줄 적어 주세요");
  const saved = (await loadSites()).filter((x) => x.host !== host);
  const entry = { host, url: link, ok: true, manual: true, site: name, what: about, from: "직접 추가", views: 0, added_at: new Date().toISOString() };
  await fs.mkdir(path.dirname(SITES_FILE), { recursive: true });
  await fs.writeFile(SITES_FILE, JSON.stringify([...saved, entry], null, 2));
  log(`사이트 목록에 추가: ${name} (${link})`);
  return entry;
}
export async function removeSite(url) {
  const host = hostOf(String(url ?? ""));
  const saved = await loadSites();
  const cur = saved.find((x) => x.host === host);
  if (cur) Object.assign(cur, { ok: false, removed: true });
  else saved.push({ host, url, ok: false, removed: true, added_at: new Date().toISOString() });
  await fs.mkdir(path.dirname(SITES_FILE), { recursive: true });
  await fs.writeFile(SITES_FILE, JSON.stringify(saved, null, 2));
  log(`사이트 목록에서 뺌: ${host}`);
  return { ok: true };
}

const SITES_TOPIC = `요즘 20~30대(MZ)가 좋아할 만한, 트렌디하고 쓸모 있는 사이트 5곳을 추천하는 카드뉴스.
목록에서 "주인이 직접 고른 곳"이라고 표시된 곳을 가장 먼저 넣고, 그다음 "요즘 유튜브에서 소개됨"이라고 표시된 곳을 고려하라.
반드시 아래 [쓸 수 있는 사이트]에서만 고르고, 이름(site)과 주소(url)를 목록에 적힌 그대로 써라. 목록에 없는 사이트는 절대 쓰지 마라.
5곳을 하나의 주제로 묶어라 (예: 심심할 때 친구랑 해 보는 재미있는 사이트, 과제·작업할 때 쓰는 사이트, 집중 안 될 때 쓰는 사이트). 표지도 그 주제로 써라.
쓸모 있는 곳만큼 "해 보면 재미있어서 친구에게 보내고 싶은 곳"도 좋다. 각 장의 title은 12자 안쪽으로 짧게, 그 사이트에서 하게 되는 일을 한마디로 써라 (사이트 이름을 그대로 쓰지 마라).
각 장의 body는 목록의 설명을 바탕으로, 언제 쓰면 좋은지를 친근하게 풀어 써라. 설명에 없는 기능을 지어내지 마라.
지금 시기(계절)와 억지로 연결하지 마라.`;

// 사이트 주소가 실제로 열리는지 확인해 열리는 장만 남김 (AI가 없는 주소를 지어내는 것을 걸러냄)
async function keepLiveSites(slides) {
  const out = [];
  for (const s of slides) {
    if (!okUrl(s.url)) continue;
    try {
      const res = await fetch(s.url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "Accept-Language": "ko" } });
      if (res.status === 404 || res.status === 410) { log(`사이트 주소가 없는 페이지입니다 (${s.url}) — 그 장을 뺍니다`); continue; }
      out.push(s);                                 // 403 같은 자동 접속 차단은 실제로 있는 사이트이므로 남김
    } catch { log(`사이트에 연결되지 않습니다 (${s.url}) — 그 장을 뺍니다`); }
  }
  return out;
}

// 수집한 소재 하나를 카드뉴스로 만듦 (주제만 참고). 그 소재는 "건너뜀"으로 옮겨 중복 제작을 막음
export async function cardFromTip(code) {
  const tip = (await loadDb()).find((t) => t.shortCode === code);
  if (!tip || tip.type === "shoot" || tip.type === "card") throw new Error("소재를 찾을 수 없습니다");
  await patchTip(code, { status: "skipped", error: "카드뉴스로 만들었습니다" });
  const topic = [tip.ko_title, tip.ko_summary, `[참고한 게시물 — 주제만 참고하고 문장은 가져오지 마라]\n${tip.tip_text.slice(0, 600)}`].filter(Boolean).join("\n");
  return planCardItem(topic, tip.ko_title || tip.tip_text.split("\n")[0].slice(0, 60));
}

async function produceCard(tip, editedScript) {
  const code = tip.shortCode;
  await patchTip(code, { status: "working", error: null });
  try {
    let script, checks = [], fixed = [], refs = tip.refs ?? null;
    if (editedScript) script = normalizeScript(editedScript, 7);
    else if (tip.kind === "news") {
      // 이번 주 소식: 뉴스 제목에서 고름. 사실을 건드리면 안 되므로 검수는 "확인할 점"만 남기고 스스로 고치지는 않음
      log(`이번 주 소식 카드뉴스 작성 ${code}`);
      const r = await writeNews();
      if (r.skip) { log(`건너뜀 ${code}: ${r.reason}`); return await patchTip(code, { status: "skipped", error: r.reason }); }
      ({ script, refs } = r);
      ({ checks } = await polish(script, "card", { fix: false }));
      checks = ["할인율·기간·장소는 기사 제목을 바탕으로 쓴 것입니다. 아래 근거 기사를 눌러 맞는지 확인해 주세요.", ...checks];
    } else {
      const db = await loadDb();
      const trends = db.filter((t) => t.status === "new" && t.ko_title).sort(byRank).slice(0, 8).map((t) => t.ko_title);
      log(`카드뉴스 대본 작성 ${code}`);
      if (tip.kind === "sites") {
        // 확인된 목록에서, 이미 올렸거나 예약한 곳을 뺀 나머지 중에서만 고르게 함
        const done = new Set(db.filter((t) => t.type === "card" && ["approved", "posted"].includes(t.status)).flatMap((t) => t.script?.slides ?? []).map((s) => s.url).filter(Boolean));
        // 주인이 직접 넣은 곳 → 유튜브에서 찾아 둔 "요즘 뜨는 사이트"(최근 것부터) → 기본 목록
        const pool = (await sitePool()).filter((p) => !done.has(p.url));
        if (pool.length < 5) throw new Error("소개할 사이트 목록이 다 떨어졌습니다. 관리 화면의 '사이트 목록'에서 새 사이트를 추가해 주세요");
        const mark = { "직접 추가": " | 주인이 직접 고른 곳", "유튜브": " | 요즘 유튜브에서 소개됨" };
        script = await writeCards(`${SITES_TOPIC}${tip.topic ? `\n주인이 바라는 방향: ${tip.topic}` : ""}\n\n[쓸 수 있는 사이트]\n${pool.map((p) => `- ${p.site} | ${p.url} | ${p.what}${mark[p.tag] ?? ""}`).join("\n")}`, [], { sites: true });
        script.slides = script.slides.filter((s) => pool.some((p) => p.url === s.url));     // 목록 밖의 사이트를 썼으면 그 장은 버림
        script.slides = await keepLiveSites(script.slides);              // 주소가 실제로 열리는 곳만 남김
        if (script.slides.length < 3) throw new Error("실제로 열리는 사이트를 3곳 이상 확인하지 못했습니다. 다시 만들어 보세요");
        script.caption = withSites(script.caption, script.slides);
      } else script = await writeCards(tip.topic, trends);
      ({ script, checks, fixed } = await polish(script, "card"));        // AI 초안은 검수를 한 번 거침
      if (tip.kind === "sites") checks = checks.filter((c) => !/접속|작동|유효성/.test(c));   // 주소가 열리는지는 위에서 이미 확인했으므로 그 지적은 뺌
    }
    const images = await renderCards(script, code, { full: tip.kind === "sites" });
    for (const old of tip.images ?? []) await fs.rm(path.join(OUT, old), { force: true });
    await patchTip(code, { status: "pending", script, images, checks, fixed, refs, tip_text: tip.topic || script.name || script.hook, rendered_at: new Date().toISOString(),
      ...(tip.kind === "news" && !editedScript && { tg: { later: -1 } }) });   // 소식은 시기가 중요하니 검토 요청을 맨 먼저 보냄
  } catch (e) {
    log(`오류 ${code}: ${e.message}`);
    await patchTip(code, { status: "error", error: e.message });
  }
}

// 장면 영상 저장 (요청 본문을 그대로 파일로 받음)
export async function saveClip(code, n, stream, filename = "") {
  const tip = (await loadDb()).find((t) => t.shortCode === code);
  if (tip?.type !== "shoot" || !tip.script) throw new Error("촬영 기획을 찾을 수 없습니다");
  if (!sceneNumbers(tip.script).includes(n)) throw new Error("없는 장면 번호입니다");
  const ext = [".mp4", ".mov", ".m4v", ".webm"].find((e) => e === path.extname(filename).toLowerCase()) ?? ".mp4";
  const dir = clipDir(code);
  await fs.mkdir(dir, { recursive: true });
  const file = `${n}-${Date.now().toString(36)}${ext}`;
  let size = 0;
  try {
    await pipeline(stream, async function* (src) {
      for await (const chunk of src) { size += chunk.length; if (size > 700e6) throw new Error("영상이 너무 큽니다 (700MB 이하)"); yield chunk; }
    }, createWriteStream(path.join(dir, file)));
    if (size < 10_000) throw new Error("영상 파일이 비어 있습니다");
  } catch (e) { await fs.rm(path.join(dir, file), { force: true }); throw e; }
  const old = await updateDb((db) => {
    const t = db.find((x) => x.shortCode === code);
    const prev = t.clips?.[n]?.file;
    t.clips = { ...t.clips, [n]: { file, size } };
    return prev;
  });
  if (old) await fs.rm(path.join(dir, old), { force: true });
  log(`장면 영상 저장 ${code} ${n ? `${n}번` : "첫 화면"} (${(size / 1e6).toFixed(1)}MB)`);
  return { n, file, size };
}

export const resetTip = async (code) => {
  const tip = (await loadDb()).find((t) => t.shortCode === code);
  if (tip?.type === "card") return patchTip(code, { status: tip.images?.length ? "pending" : "error", error: null });
  return patchTip(code, { status: tip?.type === "shoot" ? (tip.script ? "shoot" : "error") : "new", error: null });
};

// 예약 실행: 수집 → 꿀팁 영상 1건 → 촬영 대기 기획이 모자라면 1건 보충
export async function runDaily() {
  await collect();
  await discoverSites().catch((e) => log(`요즘 뜨는 사이트 찾기 오류: ${e.message.slice(0, 120)}`));
  // 이번 주 소식: 시기가 중요하므로 재고와 상관없이 매일 1편. 사흘 넘게 검토되지 않은 소식은 철이 지난 것으로 보고 치움
  if (CONFIG.dailyNews > 0) {
    const old = Date.now() - 3 * 864e5;
    for (const t of (await loadDb()).filter((x) => x.kind === "news" && ["pending", "approved"].includes(x.status) && new Date(x.rendered_at).getTime() < old)) {
      await patchTip(t.shortCode, { status: "skipped", error: "시기가 지난 소식이라 올리지 않습니다", tg: null });
    }
    if (!(await loadDb()).some((x) => x.kind === "news" && x.status === "pending")) await planCardItem("", "", null, "news").catch((e) => log(`이번 주 소식 오류: ${e.message}`));
  }
  // 검토 대기 + 발행 예약이 충분히 쌓여 있으면 새로 만들지 않음 (검토할 것이 끝없이 쌓이는 것을 막음)
  const stock = (await loadDb()).filter((t) => ["pending", "approved"].includes(t.status)).length;
  if (stock >= CONFIG.stockTarget) return log(`검토 대기와 발행 예약이 ${stock}건 있어서 오늘은 새로 만들지 않습니다 (기준 ${CONFIG.stockTarget}건)`);
  await dailyTip();
  // 카드뉴스: 공감 많은 한국 소재(추천 70점 이상)가 있으면 그것으로, 없으면 AI가 고른 주제로. 승인 대기가 3건 쌓이면 쉼
  const db = await loadDb();
  if (CONFIG.dailyCards > 0 && db.filter((t) => t.type === "card" && t.status === "pending").length < 3) {
    for (let i = 0; i < CONFIG.dailyCards; i++) {
      // 수요일과 토요일은 "트렌디한 사이트 추천", 나머지 날은 꿀팁 카드뉴스
      if ([3, 6].includes(new Date().getDay())) { await planCardItem("", "", null, "sites").catch((e) => log(`사이트 추천 오류: ${e.message}`)); continue; }
      const pick = (await loadDb()).filter((t) => t.status === "new" && t.suggest === "card" && t.fit >= 70).sort(byRank)[0];
      await (pick ? cardFromTip(pick.shortCode) : planCardItem()).catch((e) => log(`카드뉴스 오류: ${e.message}`));
    }
  }
  if ((await loadDb()).filter((t) => t.type === "shoot" && t.status === "shoot").length < CONFIG.shootPlans) {
    await planShootItem().catch((e) => log(`촬영 기획 오류: ${e.message}`));
  }
}

// 꿀팁이 될 때까지 새 소재를 최대 4건 시도해 영상 1건 제작
async function dailyTip() {
  for (let i = 0; i < 4; i++) {
    const tip = (await loadDb()).filter((t) => t.status === "new" && t.suggest !== "card").sort(byRank)[0];   // 카드뉴스 후보는 영상으로 쓰지 않음
    if (!tip) return log("새 소재가 없습니다");
    await produce(tip.shortCode);
    const after = (await loadDb()).find((t) => t.shortCode === tip.shortCode);
    if (after.status === "pending") return log("영상 1건 승인 대기 중 — 관리 화면에서 확인하세요");
    if (after.status === "error") return;
  }
}

// ── 승인과 발행 예약 ──
// 승인(approved)한 게시물은 바로 올리지 않고, POST_TIMES에 적은 시각마다 승인한 순서대로 하나씩 올림
export const postTimes = () => (process.env.POST_TIMES ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{2}:\d{2}$/.test(s)).sort();
export function upcomingSlots(n, from = new Date()) {          // 앞으로의 발행 시각 n개
  const times = postTimes(), out = [];
  for (let day = 0; times.length && out.length < n && day < 90; day++) {
    for (const hm of times) {
      const [h, m] = hm.split(":").map(Number);
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + day, h, m);
      if (d > from && out.length < n) out.push(d);
    }
  }
  return out;
}
const slotText = (d) => `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
// 발행 순서: 시기가 중요한 "이번 주 소식"을 먼저, 그다음은 승인한 순서
// 주인이 "맨 먼저 올리기"를 누른 것(first_at)이 있으면 그것이 가장 앞 (나중에 누른 것이 더 앞)
const publishQueue = (db) => db.filter((t) => t.status === "approved")
  .sort((a, b) => String(b.first_at ?? "").localeCompare(String(a.first_at ?? "")) || (b.kind === "news") - (a.kind === "news") || String(a.approved_at).localeCompare(String(b.approved_at)));
export async function publishFirst(code) {
  const tip = (await loadDb()).find((t) => t.shortCode === code);
  if (tip?.status !== "approved") throw new Error("발행 예약 상태가 아닙니다");
  await patchTip(code, { first_at: new Date().toISOString() });
  const slot = upcomingSlots(1)[0];
  return { ok: true, message: slot ? `다음 발행 시각(${slotText(slot)})에 맨 먼저 올라갑니다.` : "예약 순서의 맨 앞으로 옮겼습니다." };
}
// 캡션과 해시태그만 고침 (영상·카드를 다시 만들지 않음)
export async function saveText(code, { caption, hashtags }) {
  const tip = (await loadDb()).find((t) => t.shortCode === code);
  if (!tip?.script || !["pending", "approved"].includes(tip.status)) throw new Error("검토 대기나 발행 예약 상태에서만 글을 고칠 수 있습니다");
  const tags = String(hashtags ?? tip.script.hashtags).split(/\s+/).filter((t) => t && !t.includes("내돈내산")).join(" ");
  await patchTip(code, { script: { ...tip.script, caption: String(caption ?? tip.script.caption).trim(), hashtags: tags } });
  log(`글만 고침 ${code}`);
  return { ok: true, caption: String(caption ?? tip.script.caption).trim(), hashtags: tags };
}

export async function approveTip(code) {
  const tip = (await loadDb()).find((t) => t.shortCode === code);
  if (tip?.status !== "pending") throw new Error("검토 대기 상태가 아닙니다");
  await patchTip(code, { status: "approved", approved_at: new Date().toISOString(), first_at: null, error: null, tg: null });
  const pos = publishQueue(await loadDb()).findIndex((t) => t.shortCode === code);
  const slot = upcomingSlots(pos + 1)[pos];
  log(`승인 ${code} (발행 예약 ${pos + 1}번째)`);
  return slot ? `${slotText(slot)}에 올라갑니다 (예약 ${pos + 1}번째).` : "발행 시각이 정해져 있지 않아 예약만 해 두었습니다 (.env의 POST_TIMES).";
}
export async function unapproveTip(code) {
  const tip = (await loadDb()).find((t) => t.shortCode === code);
  if (tip?.status !== "approved") throw new Error("발행 예약 상태가 아닙니다");
  return patchTip(code, { status: "pending", approved_at: null, first_at: null, tg: null });
}
// 발행 시각이 되면 호출: 예약 순서의 맨 앞 하나를 올림
export async function publishNext() {
  const next = publishQueue(await loadDb())[0];
  if (!next) return log("발행 시각이지만 승인된 게시물이 없습니다");
  await approveAndPublish(next.shortCode);
}

// ── 텔레그램 봇으로 검토 받기: 한 번에 하나씩 보내고, 답을 받으면 다음 것을 보냄 ──
// ── 검수: 사람이 보기 전에 AI가 "다른 눈"으로 한 번 더 봄 (AI 초안이 사실·안전·제목에서 자주 틀려서 넣음) ──
async function inspect(script) {
  const d = new Date();
  const prompt = `너는 한국 인스타그램 계정 "세바꿀(세상을 바꾸는 꿀팁)"의 깐깐한 검수자다. 아래 [대본]은 다른 작가가 쓴 초안이다.
올리기 전에 문제를 찾아라. 칭찬은 필요 없다. 문제가 없으면 빈 목록을 답하라. 사소한 취향 차이는 문제로 치지 마라.
오늘은 ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일(한국)이다.

찾을 것:
1. 틀린 사실: 네가 확실히 아는 것과 다른 내용, 사이트 이름·주소와 설명이 서로 어긋난 것.
2. 확인이 필요한 사실: 금액, 세율, 날짜, 기한, 제도 이름처럼 틀리면 곤란한데 네가 확신할 수 없는 것.
3. 위험: 불, 감전, 세제 섞기, 상한 음식처럼 따라 하면 다치거나 탈이 날 수 있는 방법.
4. 첫 문구(hook) 문제: 내용이 뒷받침하지 못하는 약속, 지어낸 불이익, 과장("무조건", "100%"), hook이 말한 주제·개수와 실제 내용이 다른 것.
5. 효능을 단정하는 말("낫는다", "살이 빠진다")이나 광고처럼 들리는 표현.
6. 시기: 지금 계절과 맞지 않는 내용 (제철이 아닌 과일 등).
7. 맞춤법 오류, 뜻이 통하지 않는 문장.

8. 제목과 내용이 따로 노는 장: 장의 title이 body와 다른 말을 하거나, title에 body에 없는 물건·방법이 나오는 것.
9. 주제에서 벗어난 장: 표지(hook)가 약속한 주제에 속하지 않는 장. (예: 표지는 "패딩"인데 니트 이야기를 하는 장)

대충 훑어보지 마라. 아래 부분을 하나도 빠짐없이, 하나씩 따로 판정해서 parts에 적어라:
"표지"(hook과 sub), 각 장("1장", "2장" … slides의 순서대로 전부), "캡션", 그리고 "전체"(표지가 약속한 것과 장들이 서로 맞는지).

부분마다 적을 것:
- where: 어느 부분인지
- says: 그 부분이 말하는 핵심을 네 말로 한 줄 (장이면 "제목은 ○○, 내용은 △△")
- verdict: "문제없음", "고쳐야 함", "확인 필요" 중 하나. 숫자·날짜·주소처럼 사람이 직접 확인해야 하는 것만 "확인 필요"다.
- problem: 무엇이 문제인지 한 문장 (문제없음이면 빈 문자열)
- fix: 어떻게 고칠지 구체적인 지시 한 문장. 바꿔 넣을 문장이나 제목을 직접 적어라 (문제없음이면 빈 문자열)
  · 고친다고 새 꿀팁이나 새 사실을 지어내지 마라. 주제에서 벗어난 장이 있으면 "표지와 캡션을 장들을 모두 아우르는 말로 넓혀라"(예: 패딩 → 겨울옷)라고 적거나, 그 장을 빼라고 적어라.
  · 장이 3개보다 적어지게 빼지는 마라.

[대본]
${JSON.stringify(script, null, 1)}

JSON으로만 답하라: {"parts":[{"where":"","says":"","verdict":"","problem":"","fix":""}]}`;
  const out = await askGemini(prompt, { temperature: 0.2, rounds: 2 });
  const s = (v) => String(v ?? "").trim();
  return (Array.isArray(out?.parts) ? out.parts : [])
    .map((x) => ({ where: s(x?.where), problem: s(x?.problem), fix: s(x?.fix), sure: !/확인/.test(s(x?.verdict)), ok: /문제\s*없/.test(s(x?.verdict)) }))
    .filter((x) => !x.ok && x.problem).slice(0, 10);
}

// 초안을 검수해서 확실한 문제는 한 번 고치고, 사람이 확인할 점(checks)과 스스로 고친 곳(fixed)을 함께 돌려줌.
// 검수에 실패해도 초안은 그대로 진행함
export async function polish(script, type, { fix = true } = {}) {
  try {
    const issues = await inspect(script);
    const fixes = fix ? issues.filter((x) => x.sure && x.fix) : [];
    const checks = issues.filter((x) => !fix || !x.sure).map((x) => `${x.where}: ${x.problem}`);
    if (fixes.length) {
      log(`검수: 확실한 문제 ${fixes.length}건을 고칩니다`);
      script = await reviseScript({ script, type }, fixes.map((x, i) => `${i + 1}. [${x.where}] ${x.problem} → ${x.fix}`).join("\n"));
    }
    if (checks.length) log(`검수: 사람이 확인할 점 ${checks.length}건`);
    if (!issues.length) log("검수: 문제를 찾지 못했습니다");
    return { script, checks, fixed: fixes.map((x) => `${x.where}: ${x.problem}`) };
  } catch (e) {
    log(`검수를 건너뜁니다: ${e.message.slice(0, 120)}`);
    return { script, checks: [], fixed: [] };
  }
}

let reviewBusy = false;
let revising = false;                   // 텔레그램으로 받은 수정 요청을 처리하는 중 (그동안은 다른 검토 요청을 보내지 않음)

// 텔레그램으로 받은 "고칠 점"대로 대본을 고침. 말한 부분만 바꾸고 나머지는 그대로 둠
export async function reviseScript(tip, instruction) {
  const prompt = `너는 한국 인스타그램 계정 "세바꿀(세상을 바꾸는 꿀팁)"의 편집자다. 아래 [지금 대본]을 계정 주인이 말한 [고칠 점]대로 고쳐라.

규칙:
- 고칠 점에서 말한 부분만 바꾸고, 나머지는 글자 하나도 바꾸지 마라.
- JSON의 구조와 항목 이름을 그대로 유지하고, 모든 항목을 빠짐없이 돌려줘라 (photo, url, site, shot, keyword, shoot, alt, hook_alts, cover_photo 등 있는 것은 전부).
- slides는 순서대로 1장, 2장…이다. 장을 빼라고 하면 빼고, 더하라고 하면 같은 형식으로 더한다.
- 사진을 바꿔 달라고 하면 그 장의 photo를 다른 영어 검색어로 바꾼다 (화면에 보일 사물을 명사로, 쉼표로 2~3개). 표지 사진은 cover_photo, 영상 배경은 그 장의 keyword다.
- 주인이 알려 준 사실(숫자, 날짜, 이름)은 그대로 쓴다. 주인이 말하지 않은 새 사실을 지어내지 마라.
- 어떤 장의 내용이나 주제가 바뀌면, 그 장의 photo(또는 keyword)도 바뀐 내용에 맞는 사물로 고쳐라.
- 표지(hook)를 바꾸면 hook_alts도 바뀐 주제에 맞게 고치고, sub·cta·caption·hashtags에서 옛 주제를 말하는 부분도 함께 맞춰라.
- 과장, 효능 단정("낫는다, 살이 빠진다"), 확인 안 된 "내돈내산" 표현은 넣지 마라.
- 장의 사이트(url)가 바뀌면 caption 안의 사이트 주소 목록도 맞춰 고쳐라.

[지금 대본]
${JSON.stringify(tip.script, null, 1)}

[고칠 점]
${instruction}

JSON으로만 답하라 (지금 대본과 같은 구조).`;
  const out = normalizeScript(await askGemini(prompt, { temperature: 0.3 }), tip.type === "card" ? 7 : 5);
  if (tip.script?.cover_shot && !out.cover_shot) out.cover_shot = tip.script.cover_shot;     // 직접 올린 표지 사진은 AI가 빠뜨려도 유지
  return out;
}

// 관리 화면의 "말로 고치기": 텔레그램과 같은 방식으로 고쳐서 다시 만듦 (결과는 관리 화면과 봇 양쪽에 나옴)
export async function reviseTip(code, instruction) {
  const tip = (await loadDb()).find((t) => t.shortCode === code);
  const text = String(instruction ?? "").trim();
  if (tip?.status !== "pending" || !tip.script) throw new Error("검토 대기 상태에서만 말로 고칠 수 있습니다 (발행 예약이면 먼저 예약을 취소하세요)");
  if (text.length < 2) throw new Error("고칠 점을 적어 주세요");
  if (revising) throw new Error("다른 수정 요청을 처리하는 중입니다. 잠시 뒤에 다시 눌러 주세요");
  reviseAndResend(tip, text.slice(0, 1000), "관리 화면");
  return { ok: true };
}

async function reviseAndResend(tip, instruction, via = "텔레그램") {
  const code = tip.shortCode;
  revising = true;
  try {
    log(`${via} 수정 요청 ${code}: ${instruction.slice(0, 80)}`);
    const script = await reviseScript(tip, instruction);
    await produce(code, script);                               // 고친 대본으로 다시 만들기
    const after = (await loadDb()).find((t) => t.shortCode === code);
    if (after.status !== "pending") {                          // 실패하면 원래 것을 검토 대기로 되돌려 둠
      await patchTip(code, { status: "pending", error: null });
      throw new Error(after.error ?? "다시 만들지 못했습니다");
    }
    await patchTip(code, { tg: { later: -1, revised: true } });   // 다음 검토 요청으로 맨 먼저 다시 보냄
  } catch (e) {
    log(`${via} 수정 실패 ${code}: ${e.message}`);
    if (via === "텔레그램") tgNotify(`⚠️ 고치지 못했습니다: ${e.message.slice(0, 300)}\n원래 것은 그대로 있습니다. 조금 다르게 말해 보시거나 PC 관리 화면에서 고쳐 주세요.`);
    else await patchTip(code, { error: `말로 고치기 실패: ${e.message.slice(0, 300)} — 원래 것은 그대로 있습니다. 조금 다르게 적어 보세요.` }).catch(() => {});
  } finally { revising = false; reviewTick(); }
}

export async function reviewTick() {
  if (!tgPaired() || reviewBusy || revising) return;
  reviewBusy = true;
  try {
    const pend = (await loadDb()).filter((t) => t.status === "pending" && t.script && (t.video || t.images?.length));
    if (pend.some((t) => t.tg?.msg && t.tg.for === t.rendered_at)) return;      // 이미 보내고 답을 기다리는 것이 있음
    const next = pend.sort((a, b) => (a.tg?.later ?? 0) - (b.tg?.later ?? 0) || String(a.rendered_at).localeCompare(String(b.rendered_at)))[0];
    if (!next) return;
    const msg = await tgSendReview(next, pend.length, Boolean(next.tg?.revised));
    await patchTip(next.shortCode, { tg: { msg, for: next.rendered_at, later: Math.max(0, next.tg?.later ?? 0) } });
    log(`텔레그램으로 검토 요청 ${next.shortCode}`);
  } catch (e) { log(`텔레그램 검토 요청 오류: ${e.message}`); }
  finally { reviewBusy = false; }
}

export async function startTelegram() {
  if (!tgEnabled()) return;
  await tgStart({
    dataDir: path.join(ROOT, "data"), out: OUT, log, onIdle: () => reviewTick(),
    async onDecision(action, code) {
      const tip = (await loadDb()).find((t) => t.shortCode === code);
      if (tip?.status !== "pending") return "이미 처리된 항목입니다.";
      if (action === "a") return `✅ 승인했습니다. ${await approveTip(code)}`;
      if (action === "r") { await patchTip(code, { status: "rejected", tg: null }); log(`거절 ${code}`); return "❌ 거절했습니다. 올라가지 않습니다."; }
      await patchTip(code, { tg: { later: Date.now() } });
      return "⏭ 나중에 다시 보여 드릴게요.";
    },
    // 봇 명령으로 새 게시물 만들기: /news 이번 주 소식, /sites 사이트 추천, /card 주제
    async onCommand(name, arg) {
      const fail = (e) => { log(`봇 명령 오류: ${e.message}`); tgNotify(`⚠️ 만들지 못했습니다: ${e.message.slice(0, 200)}`); };
      if (name === "news") { planCardItem("", "", null, "news").catch(fail); return "📰 이번 주 할인·팝업·행사 소식을 찾아 카드뉴스로 만드는 중입니다. 2~3분 뒤에 보내 드릴게요."; }
      if (name === "sites") { planCardItem(arg, "", null, "sites").catch(fail); return "🌐 트렌디한 사이트 추천 카드뉴스를 만드는 중입니다. 2~3분 뒤에 보내 드릴게요."; }
      if (!arg) return "주제를 함께 적어 주세요. 예: /card 겨울 이불 보관법";
      planCardItem(arg).catch(fail);
      return `🗂 "${arg.slice(0, 40)}" 카드뉴스를 만드는 중입니다. 2~3분 뒤에 보내 드릴게요.`;
    },
    // 글로 온 메시지: "승인"·"거절"이면 그대로 처리하고, 그 밖에는 고칠 점으로 받아 고쳐서 다시 보냄
    async onText(text, replyTo) {
      if (revising) return "앞서 말씀하신 것을 고치는 중입니다. 다시 보내 드린 뒤에 이어서 말씀해 주세요.";
      const waiting = (await loadDb()).filter((t) => t.status === "pending" && t.tg?.msg && t.tg.for === t.rendered_at);
      const cur = (replyTo && waiting.find((t) => t.tg.msg === replyTo)) || waiting[0];
      if (!cur) return "지금 검토 중인 게시물이 없습니다. 검토 요청이 오면 그때 고칠 점을 적어 보내 주세요.";
      if (/^승인[.!]?$/.test(text)) { const r = await approveTip(cur.shortCode); reviewTick(); return `✅ 승인했습니다. ${r}`; }
      if (/^거절[.!]?$/.test(text)) { await patchTip(cur.shortCode, { status: "rejected", tg: null }); reviewTick(); return "❌ 거절했습니다. 올라가지 않습니다."; }
      if (text.length < 4) return "고칠 점을 조금 더 자세히 적어 주세요. 예: \"2장 문장을 더 짧게\", \"표지 제목을 ○○로 바꿔\"";
      reviseAndResend(cur, text);
      return `✏️ "${cur.script.hook}"을(를) 고치는 중입니다. 1~3분 뒤에 다시 보내 드릴게요.`;
    },
    async skipCurrent() {
      const cur = (await loadDb()).find((t) => t.status === "pending" && t.tg?.msg && t.tg.for === t.rendered_at);
      if (!cur) return "지금 검토를 기다리는 게시물이 없습니다.";
      await patchTip(cur.shortCode, { tg: { later: Date.now() } });
      reviewTick();
      return "⏭ 다음 것을 보내 드릴게요.";
    },
    async status() {
      const db = await loadDb();
      const q = publishQueue(db), slots = upcomingSlots(q.length);
      return [`검토 대기 ${db.filter((t) => t.status === "pending").length}건 · 발행 예약 ${q.length}건`,
        postTimes().length ? `발행 시각: 매일 ${postTimes().join(", ")}` : "발행 시각이 정해져 있지 않습니다.",
        ...q.slice(0, 10).map((t, i) => `· ${slots[i] ? slotText(slots[i]) : "미정"}  ${t.script.hook}`)].join("\n");
    },
  });
}
export { tgInfo };

// 지금 바로 발행 (예약 시각에도 이 함수가 불림). 검토 대기·발행 예약 상태에서만 가능
export async function approveAndPublish(code) {
  const tip = (await loadDb()).find((t) => t.shortCode === code);
  const isCard = tip?.type === "card";
  const prev = tip?.status;
  if (!(isCard ? tip.images?.length : tip?.video) || !["pending", "approved"].includes(prev)) throw new Error("발행할 수 있는 상태의 영상이나 카드뉴스가 없습니다");
  await patchTip(code, { status: "working", error: null });
  try {
    log(`발행 시작 ${code}`);
    const caption = `${tip.script.caption}\n\n${tip.script.hashtags}`.trim();
    let media_id, cover_url = null;
    if (isCard) {
      const urls = [];
      for (const file of tip.images) urls.push(await upload(file, "image"));
      cover_url = urls[0];
      media_id = await publishCarousel(urls, caption);
    } else media_id = await publishReel(await upload(tip.video), caption);
    await patchTip(code, { status: "posted", media_id, cover_url, posted_at: new Date().toISOString(), tg: null });
    log(`발행 완료 ${code} → ${media_id}`);
    afterPublish(code, media_id, tip.script.hook).catch((e) => log(`링크 페이지 갱신 오류 (발행은 완료됨): ${e.message}`));
  } catch (e) {
    log(`발행 오류 ${code}: ${e.message}`);
    // 원래 상태로 되돌림. 예약 발행이 3번 연속 실패하면 계속 막히지 않게 오류로 빼 둠
    const fails = (tip.publish_fails ?? 0) + 1;
    await patchTip(code, { status: prev === "approved" && fails >= 3 ? "error" : prev, publish_fails: fails, error: `발행 실패: ${e.message}` });
    tgNotify(`⚠️ 발행에 실패했습니다 (${fails}번째): ${tip.script.hook}\n${e.message.slice(0, 300)}`);
  }
}

// 발행이 끝난 뒤의 부가 작업: 게시물 주소를 받아 두고(링크 페이지의 "게시물 보기") 링크 페이지를 갱신.
// 여기서 실패해도 발행 상태는 건드리지 않음 (다시 발행되면 안 되므로)
async function afterPublish(code, media_id, hook) {
  const host = env("IG_ACCESS_TOKEN").startsWith("IG") ? "graph.instagram.com" : "graph.facebook.com";
  const d = await (await fetch(`https://${host}/${process.env.GRAPH_VERSION ?? "v21.0"}/${media_id}?${new URLSearchParams({ fields: "permalink", access_token: env("IG_ACCESS_TOKEN") })}`,
    { signal: AbortSignal.timeout(30_000) })).json().catch(() => ({}));
  if (d.permalink) await patchTip(code, { permalink: d.permalink });
  tgNotify(`🎉 인스타그램에 올라갔습니다: ${hook}${d.permalink ? `\n${d.permalink}` : ""}`);
  await refreshLinks();
}

export const SAMPLE = {
  hook: "냉장고, 이렇게만 바꾸세요", sub: "",
  slides: [{ title: "먼저 먹을 칸", body: "유통기한이 임박한 재료는 눈높이 칸 한 곳에 모아두세요.", keyword: "refrigerator" },
           { title: "투명 용기 통일", body: "안이 보이는 용기로 바꾸면 잊고 버리는 재료가 확 줄어요.", keyword: "food container" },
           { title: "문 칸은 소스만", body: "온도가 자주 바뀌는 문 쪽에는 우유나 달걀을 두지 마세요.", keyword: "kitchen" }],
  cta: "저장하고 주말에 해보세요", caption: "", hashtags: "",
};
