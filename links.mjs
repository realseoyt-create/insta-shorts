// 프로필 링크 페이지: 발행한 게시물에서 소개한 사이트를 한 장짜리 웹페이지로 만들어 GitHub Pages에 올림
//   .env의 GITHUB_TOKEN (그 저장소의 Contents·Pages 쓰기 권한) + GITHUB_REPO (예: 아이디/저장소이름) 가 있으면 동작
//   인스타 캡션의 주소는 눌러지지 않으므로, 프로필 링크에 이 페이지를 걸어 "눌러서 이동"하게 함
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const okUrl = (u) => /^https:\/\/[^\s"'<>]+$/.test(u ?? "");
export const linksEnabled = () => Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
export function linksUrl() {
  if (process.env.LINKS_URL) return process.env.LINKS_URL;
  const [owner, repo] = (process.env.GITHUB_REPO ?? "").split("/");
  return owner && repo ? `https://${owner.toLowerCase()}.github.io/${repo}/` : "";
}

const BEE = `<svg viewBox="0 0 200 200" width="84" height="84" aria-hidden="true"><defs><clipPath id="b"><ellipse cx="100" cy="120" rx="60" ry="54"/></clipPath></defs>
<g fill="#EAF6FF" stroke="#2B1D0E" stroke-width="5"><ellipse cx="60" cy="60" rx="25" ry="37" transform="rotate(-30 80 90)"/><ellipse cx="140" cy="60" rx="25" ry="37" transform="rotate(30 120 90)"/></g>
<g fill="none" stroke="#2B1D0E" stroke-width="5" stroke-linecap="round"><path d="M86 70 Q80 48 68 40"/><path d="M114 70 Q120 48 132 40"/></g><circle cx="66" cy="38" r="7" fill="#2B1D0E"/><circle cx="134" cy="38" r="7" fill="#2B1D0E"/>
<path d="M90 168 L110 168 L100 190 Z" fill="#2B1D0E"/><ellipse cx="100" cy="120" rx="60" ry="54" fill="#FFB400"/>
<g clip-path="url(#b)" fill="#2B1D0E"><rect x="30" y="137" width="140" height="11"/><rect x="30" y="155" width="140" height="10"/></g>
<ellipse cx="100" cy="120" rx="60" ry="54" fill="none" stroke="#2B1D0E" stroke-width="6"/>
<circle cx="78" cy="108" r="9" fill="#2B1D0E"/><circle cx="122" cy="108" r="9" fill="#2B1D0E"/><circle cx="81" cy="105" r="3" fill="#fff"/><circle cx="125" cy="105" r="3" fill="#fff"/>
<ellipse cx="62" cy="122" rx="9" ry="6" fill="#FF7A59" opacity=".75"/><ellipse cx="138" cy="122" rx="9" ry="6" fill="#FF7A59" opacity=".75"/>
<path d="M90 119 Q100 130 110 119" fill="none" stroke="#2B1D0E" stroke-width="5" stroke-linecap="round"/></svg>`;

// posts: [{ title, date, cover, permalink, links: [{ name, url }] }] — 최신순
export function buildLinksHtml(posts, { handle = "", mascot = "", notice = "" } = {}) {
  const name = handle.replace(/^@/, "");
  const day = (d) => { const t = new Date(d); return Number.isNaN(t.getTime()) ? "" : `${t.getFullYear()}.${t.getMonth() + 1}.${t.getDate()}`; };
  const cards = posts.map((p) => `
    <section class="post">
      <div class="head">${p.cover && okUrl(p.cover) ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : ""}
        <div><h2>${esc(p.title)}</h2><p class="date">${esc(day(p.date))}${p.permalink && okUrl(p.permalink) ? ` · <a href="${esc(p.permalink)}">게시물 보기</a>` : ""}</p></div></div>
      ${p.links.filter((l) => okUrl(l.url)).map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener"><span>${esc(l.name)}</span><span class="go">바로 가기 ›</span></a>`).join("")}
    </section>`).join("");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>세바꿀 꿀팁 링크</title>
<meta name="description" content="세바꿀 게시물에서 소개한 사이트로 바로 가는 링크 모음">
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" rel="stylesheet">
<style>
  :root { --honey:#FFB400; --ink:#2B1D0E; --cream:#FFF3CF; --muted:#7A6A52; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:Pretendard, 'Malgun Gothic', sans-serif; background:var(--cream); color:var(--ink); -webkit-text-size-adjust:100%; }
  main { max-width:560px; margin:0 auto; padding:28px 16px 48px; }
  header { text-align:center; margin-bottom:22px; }
  header h1 { font-size:24px; margin:6px 0 4px; }
  header p { margin:0; color:var(--muted); font-size:14px; }
  .insta { display:inline-block; margin-top:14px; background:var(--ink); color:var(--honey); font-weight:700; text-decoration:none; padding:10px 22px; border-radius:99px; font-size:15px; }
  .post { background:#fff; border-radius:20px; padding:16px; margin-bottom:16px; box-shadow:0 6px 0 rgba(43,29,14,.08); }
  .head { display:flex; gap:14px; align-items:center; margin-bottom:12px; }
  .head img { width:72px; height:90px; object-fit:cover; border-radius:12px; flex:none; background:var(--cream); }
  h2 { font-size:18px; margin:0 0 4px; line-height:1.35; word-break:keep-all; }
  .date { margin:0; font-size:13px; color:var(--muted); }
  .date a { color:var(--muted); }
  .btn { display:flex; justify-content:space-between; align-items:center; gap:10px; background:var(--honey); color:var(--ink); text-decoration:none; font-weight:700;
    font-size:16px; padding:14px 18px; border-radius:14px; margin-top:8px; word-break:keep-all; }
  .btn:active { transform:translateY(1px); }
  .go { font-size:13px; font-weight:600; white-space:nowrap; opacity:.75; }
  .empty { text-align:center; color:var(--muted); padding:40px 0; }
  #q { width:100%; font:inherit; font-size:16px; padding:13px 16px; border:2px solid var(--ink); border-radius:14px; background:#fff; color:var(--ink); margin-bottom:16px; }
  [hidden] { display:none !important; }
  footer { text-align:center; color:var(--muted); font-size:12px; line-height:1.6; margin-top:26px; }
</style>
</head>
<body>
<main>
  <header>
    ${BEE}
    <h1>세바꿀 꿀팁 링크</h1>
    <p>게시물에서 소개한 사이트로 바로 갈 수 있어요</p>
    ${name ? `<a class="insta" href="https://www.instagram.com/${esc(name)}/">인스타그램 ${esc(handle)}</a>` : ""}
  </header>
  ${posts.length >= 4 ? `<input id="q" type="search" placeholder="🔍 게시물 제목이나 사이트 이름으로 찾기" autocomplete="off">` : ""}
  ${cards || `<p class="empty">곧 첫 꿀팁 링크가 올라와요 🐝</p>`}
  <p class="empty" id="none" hidden>찾는 게시물이 없어요. 다른 낱말로 찾아보세요.</p>
  <footer>${notice ? `${esc(notice)}<br>` : ""}${mascot ? `${esc(mascot)}가 알려 주는 꿀팁` : ""}</footer>
</main>
<script>
  // 게시물이 쌓여도 예전 것을 바로 찾을 수 있게: 제목이나 사이트 이름으로 걸러 보여 줌
  var q = document.getElementById("q");
  if (q) q.addEventListener("input", function () {
    var word = q.value.trim().toLowerCase(), shown = 0;
    document.querySelectorAll(".post").forEach(function (el) { var hit = !word || el.textContent.toLowerCase().indexOf(word) >= 0; el.hidden = !hit; if (hit) shown++; });
    document.getElementById("none").hidden = shown > 0;
  });
</script>
</body>
</html>
`;
}

async function gh(pathname, init = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, { ...init, signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "link-page-publisher", ...(init.body && { "Content-Type": "application/json" }) } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// 페이지를 저장소에 올리고(내용이 같으면 건너뜀), 처음이면 GitHub Pages를 켬. 반환: { url, changed }
export async function publishLinks(posts, opts) {
  if (!linksEnabled()) return null;
  const repo = process.env.GITHUB_REPO;
  const html = buildLinksHtml(posts, opts);
  let info = await gh(`/repos/${repo}`);
  if (info.status === 401) throw new Error("GitHub 토큰이 맞지 않습니다 (.env의 GITHUB_TOKEN 확인)");
  if (info.status === 404) {                       // 저장소가 없으면 공개 저장소로 직접 만듦 (토큰에 public_repo 권한 필요)
    const made = await gh("/user/repos", { method: "POST", body: JSON.stringify({ name: repo.split("/")[1], private: false, auto_init: true,
      description: "세바꿀 꿀팁 링크 페이지 (자동 생성)" }) });
    if (made.status !== 201) throw new Error(`GitHub 저장소 ${repo}가 없고, 새로 만들지도 못했습니다 (${made.status}): ${made.body?.message ?? ""} — 토큰에 public_repo 권한을 주거나 저장소를 직접 만들어 주세요`);
    if (made.body.full_name.toLowerCase() !== repo.toLowerCase()) throw new Error(`토큰의 계정(${made.body.owner?.login})이 GITHUB_REPO의 계정과 다릅니다`);
    await new Promise((r) => setTimeout(r, 3000));  // 첫 커밋이 만들어질 때까지 잠시 대기
    info = await gh(`/repos/${repo}`);
  }
  if (info.status !== 200) throw new Error(`GitHub 저장소 ${repo}를 열 수 없습니다 (${info.status}). 저장소 이름과 토큰 권한을 확인하세요`);
  if (info.body.private) throw new Error("저장소가 비공개입니다. 무료 GitHub Pages는 공개 저장소에서만 됩니다");
  const cur = await gh(`/repos/${repo}/contents/index.html`);
  const same = cur.status === 200 && Buffer.from(cur.body.content ?? "", "base64").toString() === html;
  if (!same) {
    const put = await gh(`/repos/${repo}/contents/index.html`, { method: "PUT", body: JSON.stringify({
      message: `링크 페이지 갱신 (게시물 ${posts.length}건)`, content: Buffer.from(html).toString("base64"), ...(cur.status === 200 && { sha: cur.body.sha }) }) });
    if (put.status !== 200 && put.status !== 201) throw new Error(`링크 페이지 올리기 실패 (${put.status}): ${put.body?.message ?? ""} — 토큰에 Contents 쓰기 권한이 있는지 확인하세요`);
  }
  const pages = await gh(`/repos/${repo}/pages`);
  if (pages.status === 404) {                      // 처음 한 번: 웹페이지로 공개
    const branch = (await gh(`/repos/${repo}`)).body?.default_branch ?? "main";
    const on = await gh(`/repos/${repo}/pages`, { method: "POST", body: JSON.stringify({ source: { branch, path: "/" } }) });
    if (on.status !== 201) throw new Error(`GitHub Pages를 켜지 못했습니다 (${on.status}): ${on.body?.message ?? ""} — 저장소 Settings → Pages에서 직접 켜거나 토큰에 Pages 쓰기 권한을 주세요`);
  }
  return { url: linksUrl(), changed: !same };
}
