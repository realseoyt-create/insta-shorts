// 텔레그램 봇: 검토할 게시물을 보내 주고, 버튼으로 승인·거절을 받음
//   .env의 TELEGRAM_BOT_TOKEN 이 있으면 동작.
//   처음 한 번 연결이 필요: 관리 화면(또는 로그)에 나오는 링크(t.me/봇이름?start=숫자)를 휴대폰에서 열고 "시작"을 누르면
//   그 대화방이 주인으로 등록됨. 그 뒤에는 그 대화방의 명령과 버튼만 받음.
import fs from "node:fs/promises";
import path from "node:path";

let cfg = null;                                        // tgStart에 넘긴 설정
let state = { chat_id: null, pair_code: null, offset: 0 };
let me = null;                                         // 봇 정보 (username)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (method) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
const stateFile = () => path.join(cfg.dataDir, "telegram.json");

export const tgEnabled = () => Boolean(process.env.TELEGRAM_BOT_TOKEN);
export const tgPaired = () => Boolean(tgEnabled() && me && state.chat_id);
export const tgInfo = () => ({ enabled: tgEnabled(), paired: tgPaired(), bot: me?.username ?? "",
  link: !state.chat_id && me && state.pair_code ? `https://t.me/${me.username}?start=${state.pair_code}` : "" });

async function save() {
  await fs.mkdir(cfg.dataDir, { recursive: true });
  await fs.writeFile(stateFile(), JSON.stringify(state, null, 2));
}
// ⚠️ 텔레그램 요청은 AbortSignal로 취소하지 않는다.
//   Node v26.13에서, 같은 서버로 큰 파일을 올리는 도중에 그 서버로 보낸 다른 요청을 AbortSignal.timeout으로 취소하면
//   프로세스가 오류 메시지 없이 통째로 죽는다 (종료 코드 0xC0000409, 2026-11-12에 재현해 확인).
//   그래서 너무 오래 걸리면 "기다리기만 포기"하고(race), 파일을 올리는 동안에는 새 메시지 확인도 쉰다.
async function withLimit(promise, ms, what) {
  let timer;
  promise.catch(() => {});                              // 포기한 뒤 늦게 실패해도 처리되지 않은 오류로 남지 않게
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`텔레그램 ${what}: ${ms / 1000}초 넘게 응답이 없습니다`)), ms); })]);
  } finally { clearTimeout(timer); }
}
let uploading = 0;                                      // 파일을 올리고 있는 요청 수
async function call(method, body, timeoutMs = 60_000) {
  const res = await withLimit(fetch(url(method), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }), timeoutMs, method);
  const d = await res.json().catch(() => ({}));
  if (!d.ok) throw new Error(`텔레그램 ${method} 실패 (${res.status}): ${d.description ?? "응답 없음"}`);
  return d.result;
}
// 파일을 함께 보냄. files: { 필드이름: 파일 경로 }
async function upload(method, fields, files) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  for (const [k, file] of Object.entries(files)) form.append(k, new Blob([await fs.readFile(file)]), path.basename(file));
  uploading++;
  try {
    const res = await withLimit(fetch(url(method), { method: "POST", body: form }), 600_000, method);
    const d = await res.json().catch(() => ({}));
    if (!d.ok) throw new Error(`텔레그램 ${method} 실패 (${res.status}): ${d.description ?? "응답 없음"}`);
    return d.result;
  } finally { uploading--; }
}

// 주인에게 글 보내기 (연결 전이면 조용히 넘어감)
export async function tgNotify(text) {
  if (!tgPaired()) return;
  try { await call("sendMessage", { chat_id: state.chat_id, text: text.slice(0, 4000), disable_web_page_preview: false }); }
  catch (e) { cfg.log(e.message); }
}

// 검토 요청: 영상(또는 카드뉴스 이미지 묶음)을 먼저 보내고, 이어서 내용과 승인·거절 버튼을 보냄. 반환: 버튼이 달린 메시지 번호
export async function tgSendReview(tip, remaining, revised = false) {
  const chat_id = String(state.chat_id);
  const isCard = tip.type === "card";
  const kind = isCard ? "🗂 카드뉴스" : tip.type === "shoot" ? "🎥 직접 촬영 영상" : "🎬 꿀팁 영상";
  try {
    if (isCard && tip.images?.length) {
      const files = tip.images.slice(0, 10);
      await upload("sendMediaGroup", { chat_id, media: files.map((_, i) => ({ type: "photo", media: `attach://f${i}` })) },
        Object.fromEntries(files.map((f, i) => [`f${i}`, path.join(cfg.out, f)])));
    } else if (tip.video) {
      await upload("sendVideo", { chat_id, supports_streaming: "true", caption: `${kind} · ${tip.script.hook}`.slice(0, 1000) }, { video: path.join(cfg.out, tip.video) });
    }
  } catch (e) { cfg.log(`텔레그램 미리 보기 전송 실패 (${tip.shortCode}): ${e.message}`); }
  const s = tip.script;
  const lines = isCard ? [] : s.slides.map((x, i) => `${i + 1}. ${x.title} — ${x.body}`);
  const text = [
    revised ? `✏️ 말씀하신 대로 고쳐서 다시 보냅니다 (남은 검토 ${remaining}건)` : `📋 검토 요청 (남은 검토 ${remaining}건)`,
    `${kind}: ${s.hook}`,
    lines.length ? `\n${lines.join("\n")}` : "",
    `\n── 올라갈 글 ──\n${s.caption}\n\n${s.hashtags}`,
    tip.checks?.length ? `\n⚠️ AI 검수가 "직접 확인해 달라"고 한 점\n${tip.checks.map((c) => `· ${c}`).join("\n")}` : "",
    tip.fixed?.length ? `\n🔧 AI 검수가 스스로 고친 곳 (맞게 고쳤는지 봐 주세요)\n${tip.fixed.map((c) => `· ${c}`).join("\n")}` : "",
    tip.refs?.length ? `\n🔎 근거 기사 (눌러서 내용이 맞는지 확인)\n${tip.refs.map((r, i) => `${i + 1}. ${r.source} · ${r.title}${r.official ? ` (공식 자료, ${r.date})` : ""}${r.link ? `\n${r.link}` : ""}`).join("\n")}` : "",
    `\n숫자·날짜·주소가 맞는지 보고 눌러 주세요. 고칠 점이 있으면 여기에 글로 적어 보내면 고쳐서 다시 보내 드립니다.`,
  ].filter(Boolean).join("\n").slice(0, 4000);
  const msg = await call("sendMessage", { chat_id, text, disable_web_page_preview: true, reply_markup: { inline_keyboard: [
    [{ text: "✅ 승인", callback_data: `a:${tip.shortCode}` }, { text: "❌ 거절", callback_data: `r:${tip.shortCode}` }],
    [{ text: "⏭ 나중에 보기", callback_data: `l:${tip.shortCode}` }],
  ] } });
  return msg.message_id;
}

const HELP = `세바꿀 봇 사용법
· 새 게시물이 만들어지면 여기로 미리 보기와 함께 보내 드립니다.
· ✅ 승인을 누르면 정해진 시각에 차례대로 인스타그램에 올라갑니다.
· ❌ 거절을 누르면 올라가지 않습니다.
· 고치고 싶으면 고칠 점을 그냥 글로 보내세요. 예: "2장 문장을 더 짧게", "표지 제목을 ○○로 바꿔", "3장 사진 다른 걸로". 고쳐서 다시 보내 드립니다.
· /news — 이번 주 할인·팝업·행사 소식 카드뉴스 만들기
· /sites — 트렌디한 사이트 추천 카드뉴스 만들기
· /card 주제 — 그 주제로 카드뉴스 만들기 (예: /card 겨울 이불 보관법)
· /status — 검토 대기와 발행 예약 현황
· /next — 지금 것은 나중에 보고 다음 것 받기
· /help — 이 안내`;

async function handle(u) {
  const m = u.message;
  if (m?.text) {
    const text = m.text.trim();
    if (!state.chat_id) {                              // 아직 주인이 없음: 연결 번호가 맞는 개인 대화만 주인으로 등록
      if (m.chat.type !== "private") return;
      const code = text.replace(/^\/start\s*/, "");
      if (state.pair_code && code === state.pair_code) {
        state.chat_id = m.chat.id; state.pair_code = null;
        await save();
        cfg.log("텔레그램 봇이 연결됐습니다");
        await call("sendMessage", { chat_id: m.chat.id, text: `연결됐습니다 🐝\n\n${HELP}` });
        cfg.onIdle?.();
      } else await call("sendMessage", { chat_id: m.chat.id, text: "연결 번호가 맞지 않습니다. PC 관리 화면에 나온 연결 링크로 다시 들어와 주세요." });
      return;
    }
    if (m.chat.id !== state.chat_id) return;           // 주인이 아닌 대화는 무시
    if (/^\/status/.test(text)) return void await call("sendMessage", { chat_id: m.chat.id, text: (await cfg.status()).slice(0, 4000) });
    if (/^\/next/.test(text)) return void await call("sendMessage", { chat_id: m.chat.id, text: await cfg.skipCurrent() });
    const cm = text.match(/^\/(news|sites|card)(?:@\w+)?\s*([\s\S]*)$/);
    if (cm) return void await call("sendMessage", { chat_id: m.chat.id, text: await cfg.onCommand(cm[1], cm[2].trim()).catch((e) => `처리하지 못했습니다: ${e.message}`) });
    if (/^\/(help|start)/.test(text)) return void await call("sendMessage", { chat_id: m.chat.id, text: HELP });
    // 그 밖의 글은 "고칠 점"으로 받음. 검토 메시지에 답장으로 쓰면 그 게시물을, 그냥 쓰면 지금 검토 중인 게시물을 고침
    const answer = await cfg.onText(text, m.reply_to_message?.message_id).catch((e) => `처리하지 못했습니다: ${e.message}`);
    return void await call("sendMessage", { chat_id: m.chat.id, text: answer.slice(0, 4000) });
  }
  const q = u.callback_query;
  if (q) {
    if (q.message?.chat.id !== state.chat_id) return void await call("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
    const i = String(q.data ?? "").indexOf(":");
    const result = await cfg.onDecision(q.data.slice(0, i), q.data.slice(i + 1)).catch((e) => `처리하지 못했습니다: ${e.message}`);
    await call("answerCallbackQuery", { callback_query_id: q.id, text: result.slice(0, 190) }).catch(() => {});
    // 버튼을 없애고 결과를 메시지 끝에 적어 둠
    await call("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, disable_web_page_preview: true,
      text: `${q.message.text ?? ""}\n\n${result}`.slice(0, 4090) }).catch(() => {});
    cfg.onIdle?.();
  }
}

async function poll() {
  for (;;) {
    try {
      while (uploading) await sleep(2000);             // 파일을 올리는 동안에는 새 메시지 확인을 쉼
      const updates = await call("getUpdates", { offset: state.offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, 120_000);
      for (const u of updates) {
        state.offset = u.update_id + 1;
        await handle(u).catch((e) => cfg.log(`텔레그램 처리 오류: ${e.message}`));
      }
      if (updates.length) await save();
    } catch (e) {
      if (!/응답이 없습니다/.test(e.message)) cfg.log(e.message.slice(0, 160));
      await sleep(/409/.test(e.message) ? 15_000 : 5_000);       // 409 = 같은 봇을 다른 곳에서도 받고 있음
    }
  }
}

// config: { dataDir, out, log, onDecision(action, code) → 결과 글, status() → 현황 글, skipCurrent() → 결과 글, onIdle() }
export async function tgStart(config) {
  if (!tgEnabled()) return;
  cfg = config;
  try { state = { ...state, ...JSON.parse(await fs.readFile(stateFile(), "utf8")) }; } catch { /* 처음 실행 */ }
  me = await call("getMe");
  if (!state.chat_id && !state.pair_code) { state.pair_code = String(Math.floor(100000 + Math.random() * 900000)); await save(); }
  await call("setMyCommands", { commands: [
    { command: "news", description: "이번 주 할인·팝업·행사 소식 만들기" },
    { command: "sites", description: "트렌디한 사이트 추천 만들기" },
    { command: "card", description: "주제를 적어 카드뉴스 만들기" },
    { command: "status", description: "검토 대기·발행 예약 현황" },
    { command: "next", description: "지금 것은 나중에 보고 다음 것 받기" },
    { command: "help", description: "사용법" },
  ] }).catch(() => {});
  cfg.log(state.chat_id ? `텔레그램 봇 @${me.username} 연결됨` : `텔레그램 봇 연결 대기: 휴대폰에서 ${tgInfo().link} 을 열고 "시작"을 누르세요`);
  poll();
}
