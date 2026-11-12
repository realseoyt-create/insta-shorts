// 자막 나누기: 낱말들을 "한 번에 보일 묶음"으로 나누고, 묶음 안의 줄바꿈을 미리 정해 둠.
// 예전에는 글자 수로만 끊고 줄바꿈을 화면에 맡겨서, 한두 글자짜리 낱말이 아랫줄에 혼자 떨어지거나
// "들었을 / 때", "오늘 / 밤"처럼 붙어 있어야 할 말이 갈라지곤 했음.
// 지금은 끊을 수 있는 자리마다 "끊으면 얼마나 어색한지" 점수를 매기고, 전체가 가장 덜 어색한 나눔을 고름.
export type Word = { text: string; startMs: number; endMs: number };
export type Page = { words: Word[]; lines: Word[][]; fit: number };   // fit: 한 줄에 다 들어가도록 글자를 줄이는 비율 (보통 1)

// 글자 너비 어림 (글자 크기를 1로 봤을 때): 한글·한자 1, 영문·숫자 0.58, 기호 0.35
export const widthOf = (s: string) => [...s].reduce((a, c) => a + (/[가-힣ㄱ-ㅎㅏ-ㅣ一-龥]/.test(c) ? 1 : /[A-Za-z0-9%]/.test(c) ? 0.58 : 0.35), 0);

const END = /[.!?…]["')]?$/;                              // 문장 끝
const bare = (s: string) => s.replace(/[.,!?…"'()]/g, "");
// 뒤에 오는 말과 붙어 다니는 말 (여기서 끊으면 어색함): "절대 / 버리지", "오늘 / 밤", "이 / 방법"
const BIND = new Set(["절대", "그냥", "바로", "다시", "훨씬", "가장", "제일", "너무", "아주", "정말", "진짜", "꼭", "잘", "좀", "더", "덜", "안", "못", "참", "딱", "늘", "항상", "자주", "먼저", "이미", "아직", "계속",
  "매일", "오늘", "내일", "어제", "이번", "다음", "지난", "올해", "이", "그", "저", "한", "두", "세", "네", "각", "첫", "새", "모든", "어떤", "무슨", "여러", "약", "거의", "조금", "많이", "살짝", "미리", "같이", "함께"]);
// 앞말에 기대는 말 (이 말 앞에서 끊으면 어색함): "들었을 / 때", "부츠 / 속에", "쓸 / 수"
const DEPEND = /^(때|수|것|거|걸|게|건|줄|뒤|후|전|중|채|만큼|경우|정도|때문|동안|사이|밑|속|안|위|아래|옆|앞|밖|쪽|곳|데|번|개|가지|분|초|일|주|달|년|원|밤|낮|아침|저녁|있어요|없어요|있습니다|없습니다|돼요|됩니다|보세요|주세요|마세요|두세요|같아요|해요|봐요)(에|에서|에는|에도|은|는|이|가|을|를|로|으로|까지|부터|만|도|의|와|과|마다|예요|이에요|입니다)?$/;
// 뒤의 말을 꾸미는 말: "깔끔한 / 칸막이", "작은 / 귤", "쓸 / 수"
const MODIFY = /(한|된|던|운|른|린|진|적인|같은|많은|작은|얇은|좋은|깊은|높은|짧은|넓은|좁은|젖은|익은|묵은|남은|낡은|마른|긴|큰|단|쓴|찬|하는|되는|있는|없는|않는|었을|았을|였을|했을|할|될|쓸|볼|먹을|넣을|닦을|버릴|고를|만들)$/;
// 뜻이 한 번 끊기는 이음말: "~하고", "~면", "~서", "~지만"
const CONNECT = /(하고|리고|르고|우고|이고|넣고|놓고|두고|쓰고|치고|지고|기고|히고|되고|않고|없고|있고|말고|으면|하면|되면|[가-힣]면|어서|아서|해서|[가-힣]며|지만|는데|니까|려면|다가|도록|으니|한 뒤|은 뒤)$/;
const PARTICLE = /(은|는|이|가|을|를|에|에서|에게|로|으로|도|만|과|와|부터|까지|보다|처럼|마다|요|다|죠)$/;

// prev와 next 사이에서 끊으면 얼마나 어색한지 (낮을수록 끊기 좋음)
function breakCost(prev: string, next: string) {
  const p = bare(prev), n = bare(next);
  let c: number;
  if (/[,;:]$/.test(prev)) c = -2.5;
  else if (BIND.has(p)) c = 3;
  else if (MODIFY.test(p)) c = 2.5;
  else if (CONNECT.test(p) && p.length >= 2) c = -2;
  else if (/의$/.test(p)) c = 2;
  else if (PARTICLE.test(p) || /(걸|게|건)$/.test(p)) c = 0;
  else c = 1.8;                                       // 조사 없는 말은 뒤의 말과 한 덩어리일 때가 많음 ("미끄럼 방지 패드")
  if (DEPEND.test(n)) c += 4;
  return c;
}

// maxLines: 한 묶음의 최대 줄 수. whole: 되도록 한 묶음으로 유지 (표지가 되는 첫 문구용)
export function layoutCaptions(words: Word[], lineCap: number, gap = 0.25, opts: { maxLines?: number; whole?: boolean } = {}): Page[] {
  const maxLines = opts.maxLines ?? 2, pageExtra = opts.whole ? 5 : 2.4;   // 묶음을 잘게 쪼개지 않도록, 묶음을 넘길 때마다 붙는 기본 점수
  const lineMax = lineCap * 1.1;                                            // 조금 넘치는 줄은 글자를 살짝(10%까지) 줄여서 넣음
  const len = (ws: Word[]) => ws.reduce((a, w) => a + widthOf(w.text), 0) + gap * Math.max(0, ws.length - 1);

  // 낱말 묶음 하나를 줄로 나누는 가장 좋은 방법과 그 점수 (나눌 수 없으면 null)
  const breakLines = (page: Word[]): { lines: Word[][]; cost: number } | null => {
    if (len(page) <= lineCap) return { lines: [page], cost: 0 };             // 한 줄에 들어가면 줄을 나누지 않음
    let best: { lines: Word[][]; cost: number } | null = null;
    const tryCuts = (cuts: number[]) => {
      const lines = [0, ...cuts].map((from, i, a) => page.slice(from, a[i + 1] ?? page.length));
      const sizes = lines.map(len);
      if (sizes.some((s) => s > lineMax)) return;
      let cost = (Math.max(...sizes) - Math.min(...sizes)) * 0.5 + cuts.length * 0.4 + Math.max(0, Math.max(...sizes) - lineCap) * 1.5;
      for (const c of cuts) cost += breakCost(page[c - 1].text, page[c].text);
      lines.forEach((l, i) => { if (lines.length > 1 && l.length === 1 && sizes[i] < 2.6) cost += 3; });   // 짧은 낱말 하나만 있는 줄은 피함
      if (!best || cost < best.cost) best = { lines, cost };
    };
    tryCuts([]);
    for (let a = 1; a < page.length; a++) {
      tryCuts([a]);
      if (maxLines >= 3) for (let b = a + 1; b < page.length; b++) tryCuts([a, b]);
    }
    if (!best && page.length === 1) return { lines: [page], cost: 0 };       // 아주 긴 낱말 하나는 글자를 줄여 넣음
    return best;
  };

  // 문장 단위로 먼저 나누고, 문장 안에서 가장 덜 어색한 묶음 나눔을 찾음
  const sentences: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) { cur.push(w); if (END.test(w.text)) { sentences.push(cur); cur = []; } }
  if (cur.length) sentences.push(cur);

  const pages: Page[] = [];
  for (const s of sentences) {
    const n = s.length;
    const cost: number[] = Array(n + 1).fill(Infinity), from: number[] = Array(n + 1).fill(-1), laid: (Word[][] | null)[] = Array(n + 1).fill(null);
    cost[0] = 0;
    for (let j = 1; j <= n; j++) {
      for (let i = 0; i < j; i++) {
        if (cost[i] === Infinity) continue;
        const page = s.slice(i, j), b = breakLines(page);
        if (!b) continue;
        let c = cost[i] + b.cost;
        if (j < n) c += breakCost(s[j - 1].text, s[j].text) * 1.6 + pageExtra;           // 묶음을 넘기는 것은 줄바꿈보다 더 크게 끊김
        if (n > 1 && len(page) < lineCap * 0.5) c += page.length === 1 ? 3 : 1.5;         // 너무 짧은 묶음(특히 낱말 하나)은 피함
        if (c < cost[j]) { cost[j] = c; from[j] = i; laid[j] = b.lines; }
      }
    }
    const found: Page[] = [];
    for (let j = n; j > 0 && from[j] >= 0; j = from[j]) {
      const lines = laid[j]!;
      found.unshift({ words: s.slice(from[j], j), lines, fit: Math.min(1, lineCap / Math.max(...lines.map(len))) });
    }
    pages.push(...found);
  }
  return pages;
}
