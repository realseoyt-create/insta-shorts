// 설명형 쇼츠 1편: 유통기한과 소비기한 (이 편만을 위해 그린 화면)
import React from "react";
import { Composition, interpolate, useCurrentFrame } from "remotion";
import { Honeycomb, useFonts } from "../../src/Shorts";
import { BODY, Bee, CORAL, CREAM, Captions, Chrome, DARK, DISPLAY, FPS, Fill, H, HONEY, INK, Line, Props, Scenes, Source, Voice, W, cue, ease, pop, totalFrames, useTalk } from "../kit";

const MILK = "#6BB8FF";       // 우유 장면에만 쓰는 강조색
const sceneIn = (frame: number, first: boolean) => (first ? 1 : ease(frame, 0, 6));

// 포장지의 날짜 표시처럼 보이는 딱지
const DateTag: React.FC<{ word: string; honey?: boolean; size?: number; dim?: number }> = ({ word, honey, size = 92, dim = 1 }) => (
  <span style={{ display: "inline-block", fontFamily: DISPLAY, fontSize: size, lineHeight: 1, padding: `${size * 0.2}px ${size * 0.34}px`, borderRadius: size * 0.26,
    background: honey ? HONEY : INK, color: honey ? INK : CREAM, opacity: dim, border: `5px solid ${INK}` }}>{word}</span>
);

// 1. 첫 화면 (표지): 제목 + 날짜 딱지
const Hook: React.FC<{ line: Line; talk: number }> = ({ line, talk }) => {
  const f = useCurrentFrame();
  const ring = pop(f, cue(line, "앞"));
  return (
    <Fill style={{ background: DARK }}>
      <Honeycomb />
      <div style={{ position: "absolute", top: 320, left: 70, right: 70, fontFamily: DISPLAY, fontSize: 132, lineHeight: 1.2, color: "#fff", wordBreak: "keep-all" }}>
        포장지 날짜,<br /><span style={{ color: HONEY }}>앞 글자</span> 바뀐 거<br />아세요?
      </div>
      <div style={{ position: "absolute", right: 64, top: 600 + Math.sin(f / 9) * 12 }}><Bee size={250} frame={f} talk={talk} style={{ filter: "drop-shadow(0 0 5px rgba(255,255,255,.95))" }} /></div>
      <div style={{ position: "absolute", top: 930, left: 110, width: 860, transform: "rotate(-3deg)", background: CREAM, border: `6px solid ${INK}`, borderRadius: 40, padding: "34px 44px 44px",
        boxShadow: "0 18px 0 rgba(0,0,0,.35)" }}>
        <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 38, color: "rgba(43,29,14,.55)", marginBottom: 22 }}>두부 · 냉장 보관</div>
        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          <span style={{ position: "relative" }}>
            <DateTag word="유통기한" />
            <span style={{ position: "absolute", inset: -22, border: `10px solid ${HONEY}`, borderRadius: 46, opacity: Math.min(1, ring * 1.4), transform: `scale(${interpolate(ring, [0, 1], [1.5, 1])})` }} />
          </span>
          <span style={{ fontFamily: BODY, fontWeight: 800, fontSize: 80, color: INK, letterSpacing: -2 }}>26.11.20</span>
        </div>
      </div>
    </Fill>
  );
};

// 2. 유통기한 → 소비기한으로 바뀜
const Change: React.FC<{ line: Line }> = ({ line }) => {
  const f = useCurrentFrame();
  const strike = ease(f, cue(line, "유통기한"), cue(line, "유통기한") + 10);
  const neo = pop(f, cue(line, "소비기한"));
  return (
    <Fill style={{ background: DARK, opacity: sceneIn(f, false) }}>
      <Honeycomb />
      <div style={{ position: "absolute", top: 310, left: 0, right: 0, textAlign: "center", transform: `scale(${pop(f, 2)})` }}>
        <span style={{ background: HONEY, color: INK, fontFamily: DISPLAY, fontSize: 68, padding: "16px 44px", borderRadius: 50 }}>2023년 1월 1일부터</span>
      </div>
      <div style={{ position: "absolute", top: 500, left: 90, right: 90, height: 640, background: CREAM, border: `6px solid ${INK}`, borderRadius: 48, boxShadow: "0 18px 0 rgba(0,0,0,.35)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26 }}>
        <span style={{ position: "relative" }}>
          <DateTag word="유통기한" size={110} dim={interpolate(strike, [0, 1], [1, 0.35])} />
          <span style={{ position: "absolute", left: -20, top: "50%", height: 14, marginTop: -7, width: `calc(${strike * 100}% + ${strike * 40}px)`, background: CORAL, borderRadius: 7, transform: "rotate(-4deg)" }} />
        </span>
        <svg width="90" height="100" viewBox="0 0 90 100" style={{ opacity: Math.min(1, neo * 1.5) }}><path d="M45 6 V78 M14 52 L45 88 L76 52" fill="none" stroke={INK} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span style={{ transform: `scale(${neo})`, opacity: Math.min(1, neo * 1.5) }}><DateTag word="소비기한" honey size={150} /></span>
      </div>
      <Source text="식품의약품안전처" />
    </Fill>
  );
};

// 3. 둘의 뜻과, 날짜가 놓이는 자리
const Diff: React.FC<{ line: Line }> = ({ line }) => {
  const f = useCurrentFrame();
  const a = pop(f, cue(line, "유통기한은"), 16), bAt = cue(line, "소비기한은"), b = pop(f, bAt, 16);
  const fillA = ease(f, cue(line, "유통기한은") + 6, cue(line, "유통기한은") + 30), fillB = ease(f, bAt + 6, bAt + 30);
  const card = (on: number, honey: boolean): React.CSSProperties => ({ position: "absolute", left: 70, right: 70, background: honey ? HONEY : "#fff", border: `6px solid ${INK}`, borderRadius: 40,
    padding: "28px 40px 32px", boxShadow: "0 12px 0 rgba(43,29,14,.14)", opacity: Math.min(1, on * 1.5), transform: `translateX(${interpolate(on, [0, 1], [-90, 0])}px)` });
  const track = 900, x = (p: number) => 90 + track * p;
  return (
    <Fill style={{ background: CREAM, opacity: sceneIn(f, false) }}>
      <div style={{ position: "absolute", top: 270, left: 70, fontFamily: DISPLAY, fontSize: 104, color: INK }}>뭐가 달라요?</div>
      <div style={{ ...card(a, false), top: 420 }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 48, background: INK, color: CREAM, padding: "6px 24px", borderRadius: 20 }}>유통기한</span>
        <div style={{ fontFamily: DISPLAY, fontSize: 92, color: INK, marginTop: 14, lineHeight: 1.1 }}>팔아도 되는 날짜</div>
      </div>
      <div style={{ ...card(b, true), top: 690 }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 48, background: INK, color: HONEY, padding: "6px 24px", borderRadius: 20 }}>소비기한</span>
        <div style={{ fontFamily: DISPLAY, fontSize: 92, color: INK, marginTop: 14, lineHeight: 1.1 }}>먹어도 안전한 날짜</div>
        <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 40, color: INK, marginTop: 8 }}>단, 적힌 보관 방법을 지켰을 때</div>
      </div>
      {/* 만든 날 ~ 품질이 변하는 때 사이에서 두 날짜가 놓이는 자리 */}
      <div style={{ position: "absolute", top: 1020, left: 0, right: 0, height: 170, opacity: Math.min(1, a * 1.5) }}>
        <div style={{ position: "absolute", left: 90, top: 66, width: track, height: 36, borderRadius: 18, background: "rgba(43,29,14,.14)" }} />
        <div style={{ position: "absolute", left: 90, top: 66, width: track * 0.85 * fillB, height: 36, borderRadius: 18, background: HONEY, border: fillB > 0.02 ? `4px solid ${INK}` : "none", boxSizing: "border-box" }} />
        <div style={{ position: "absolute", left: 90, top: 66, width: track * 0.65 * fillA, height: 36, borderRadius: 18, background: INK }} />
        <div style={{ position: "absolute", left: x(0.65) - 110, top: 0, width: 220, textAlign: "center", fontFamily: BODY, fontWeight: 800, fontSize: 38, color: INK, opacity: fillA }}>60~70%</div>
        <div style={{ position: "absolute", left: x(0.85) - 110, top: 0, width: 220, textAlign: "center", fontFamily: BODY, fontWeight: 800, fontSize: 38, color: "#B27A00", opacity: fillB }}>80~90%</div>
        <div style={{ position: "absolute", left: 90, top: 116, fontFamily: BODY, fontWeight: 700, fontSize: 32, color: "rgba(43,29,14,.6)" }}>만든 날</div>
        <div style={{ position: "absolute", right: 90, top: 116, fontFamily: BODY, fontWeight: 700, fontSize: 32, color: "rgba(43,29,14,.6)" }}>품질이 변하는 때</div>
      </div>
      <Source text="식품의약품안전처 (통상적인 기준)" dark={false} />
    </Fill>
  );
};

// 4. 같은 식품인데 적힌 날짜가 길어짐 (참고값)
const Longer: React.FC<{ line: Line }> = ({ line }) => {
  const f = useCurrentFrame();
  const rowsAt = cue(line, "식약처"), intro = 1 - ease(f, rowsAt - 6, rowsAt);
  const MAXDAY = 81, FULL = 920;
  const row = (name: string, before: number, after: number, at: number, top: number) => {
    const on = pop(f, at, 16), grow = ease(f, at + 8, at + 34), day = Math.round(before + (after - before) * grow);
    return (
      <div style={{ position: "absolute", top, left: 80, right: 80, opacity: Math.min(1, on * 1.5), transform: `translateY(${interpolate(on, [0, 1], [50, 0])}px)` }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 104, color: "#fff" }}>{name}</span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
            <span style={{ fontFamily: BODY, fontWeight: 800, fontSize: 66, color: "rgba(255,255,255,.55)" }}>{before}일</span>
            <span style={{ fontFamily: BODY, fontWeight: 800, fontSize: 60, color: "rgba(255,255,255,.55)" }}>→</span>
            <span style={{ fontFamily: DISPLAY, fontSize: 128, color: HONEY, minWidth: 250, textAlign: "right" }}>{day}일</span>
          </span>
        </div>
        <div style={{ position: "relative", height: 50, marginTop: 14 }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: 50, borderRadius: 25, width: FULL * ((before + (after - before) * grow) / MAXDAY), background: HONEY }} />
          <div style={{ position: "absolute", left: 0, top: 0, height: 50, borderRadius: 25, width: FULL * (before / MAXDAY), background: "#8A8272" }} />
        </div>
      </div>
    );
  };
  return (
    <Fill style={{ background: DARK, opacity: sceneIn(f, false) }}>
      <Honeycomb />
      <div style={{ position: "absolute", top: 270, left: 70, right: 70, fontFamily: DISPLAY, fontSize: 96, color: "#fff", lineHeight: 1.15 }}>같은 식품,<br /><span style={{ color: HONEY }}>길어진 날짜</span></div>
      {/* 첫 문장 동안: 날짜 막대가 늘어나는 그림 */}
      <div style={{ position: "absolute", top: 700, left: 80, right: 80, opacity: intro }}>
        <div style={{ height: 70, borderRadius: 35, background: "rgba(255,255,255,.14)" }} />
        <div style={{ position: "absolute", top: 0, left: 0, height: 70, borderRadius: 35, background: HONEY, width: `${interpolate(ease(f, 6, 50), [0, 1], [42, 100])}%` }} />
        <div style={{ position: "absolute", top: 0, left: 0, height: 70, borderRadius: 35, background: "#8A8272", width: "42%" }} />
        <div style={{ display: "flex", gap: 40, marginTop: 30, fontFamily: BODY, fontWeight: 800, fontSize: 42 }}>
          <span style={{ color: "#B8B0A0" }}>■ 유통기한</span><span style={{ color: HONEY }}>■ 소비기한</span>
        </div>
      </div>
      <div style={{ position: "absolute", top: 520, left: 80, opacity: 1 - intro }}>
        <span style={{ fontFamily: BODY, fontWeight: 800, fontSize: 42, color: HONEY, border: `4px solid ${HONEY}`, borderRadius: 40, padding: "8px 28px" }}>식약처 소비기한 참고값</span>
      </div>
      {row("두부", 17, 23, cue(line, "두부는"), 640)}
      {row("과자", 45, 81, cue(line, "과자는"), 920)}
      <Source text="식품의약품안전처 참고값 (2022.12), 실제 날짜는 제품마다 다름" />
    </Fill>
  );
};

// 5. 소비기한은 마지막 날: 지나면 먹지 않기, 보관 방법 지키기
const Last: React.FC<{ line: Line }> = ({ line }) => {
  const f = useCurrentFrame();
  const big = pop(f, cue(line, "진짜")), r1 = pop(f, cue(line, "지나면"), 16), r2 = pop(f, cue(line, "적힌"), 16);
  const rule = (on: number, top: number, color: string, mark: string, text: string) => (
    <div style={{ position: "absolute", top, left: 80, right: 80, display: "flex", alignItems: "center", gap: 34, opacity: Math.min(1, on * 1.5), transform: `translateX(${interpolate(on, [0, 1], [-80, 0])}px)` }}>
      <svg width="130" height="130" viewBox="0 0 130 130" style={{ flex: "none" }}><circle cx="65" cy="65" r="60" fill={color} /><path d={mark} fill="none" stroke={INK} strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span style={{ fontFamily: DISPLAY, fontSize: 88, color: "#fff", lineHeight: 1.15 }}>{text}</span>
    </div>
  );
  return (
    <Fill style={{ background: DARK, opacity: sceneIn(f, false) }}>
      <Honeycomb />
      <div style={{ position: "absolute", top: 290, left: 80, transform: `scale(${pop(f, 2)})`, transformOrigin: "left center" }}><DateTag word="소비기한" honey size={104} /></div>
      <div style={{ position: "absolute", top: 480, left: 80, right: 60, fontFamily: DISPLAY, fontSize: 150, lineHeight: 1.1, color: "#fff", transform: `scale(${interpolate(big, [0, 1], [0.7, 1])})`, transformOrigin: "left center", opacity: Math.min(1, big * 1.5) }}>
        = 진짜<br /><span style={{ color: CORAL }}>마지막 날</span>
      </div>
      {rule(r1, 880, CORAL, "M42 42 L88 88 M88 42 L42 88", "지나면 먹지 않기")}
      {rule(r2, 1050, HONEY, "M36 68 L58 90 L96 44", "보관 방법 꼭 지키기")}
      <Source text="식품의약품안전처" />
    </Fill>
  );
};

// 6. 냉장 우유는 2031년부터
const Milk: React.FC<{ line: Line }> = ({ line }) => {
  const f = useCurrentFrame();
  const year = pop(f, cue(line, "2031"));
  return (
    <Fill style={{ background: CREAM, opacity: sceneIn(f, false) }}>
      <div style={{ position: "absolute", top: 270, left: 70, fontFamily: DISPLAY, fontSize: 104, color: INK }}>참고로,</div>
      <svg width="460" height="736" viewBox="0 0 400 640" style={{ position: "absolute", left: 60, top: 440, transform: `rotate(${Math.sin(f / 14) * 1.5 - 3}deg)` }}>
        <path d="M70 170 L200 40 L330 170 Z" fill="#fff" stroke={INK} strokeWidth="12" strokeLinejoin="round" />
        <path d="M150 40 H250 V90 H150 Z" fill={MILK} stroke={INK} strokeWidth="12" strokeLinejoin="round" />
        <rect x="70" y="170" width="260" height="440" rx="18" fill="#fff" stroke={INK} strokeWidth="12" />
        <path d="M70 420 Q135 380 200 420 T330 420 V600 H70 Z" fill={MILK} />
        <rect x="70" y="170" width="260" height="440" rx="18" fill="none" stroke={INK} strokeWidth="12" />
        <text x="200" y="300" textAnchor="middle" fontFamily="Jua" fontSize="92" fill={INK}>우유</text>
        <rect x="100" y="500" width="200" height="66" rx="16" fill={INK} /><text x="200" y="547" textAnchor="middle" fontFamily="Jua" fontSize="44" fill={CREAM}>유통기한</text>
      </svg>
      <div style={{ position: "absolute", left: 540, right: 40, top: 560, fontFamily: DISPLAY, color: INK }}>
        <div style={{ fontSize: 104, lineHeight: 1.1 }}>냉장<br />우유는</div>
        <div style={{ marginTop: 34, transform: `scale(${year})`, transformOrigin: "left center", opacity: Math.min(1, year * 1.5) }}>
          <span style={{ display: "inline-block", background: HONEY, border: `6px solid ${INK}`, borderRadius: 40, padding: "10px 30px", fontSize: 138, lineHeight: 1.1 }}>2031년</span>
        </div>
        <div style={{ fontSize: 80, marginTop: 28, opacity: Math.min(1, year * 1.5) }}>부터 바뀌어요</div>
      </div>
      <Source text="식품의약품안전처" dark={false} />
    </Fill>
  );
};

// 7. 마무리
const Outro: React.FC<{ line: Line; talk: number; handle: string }> = ({ line, talk, handle }) => {
  const f = useCurrentFrame();
  const t2 = pop(f, cue(line, "앞")), pill = pop(f, cue(line, "확인해") + 6);
  return (
    <Fill style={{ background: DARK, opacity: sceneIn(f, false), alignItems: "center" }}>
      <Honeycomb />
      <div style={{ position: "absolute", top: 300 + Math.sin(f / 9) * 14, transform: `scale(${pop(f, 2, 11)})` }}><Bee size={430} frame={f} talk={talk} style={{ filter: "drop-shadow(0 0 5px rgba(255,255,255,.95))" }} /></div>
      <div style={{ position: "absolute", top: 800, left: 0, right: 0, textAlign: "center", fontFamily: DISPLAY, lineHeight: 1.2 }}>
        <div style={{ fontSize: 108, color: "#fff" }}>오늘 냉장고 열고</div>
        <div style={{ fontSize: 124, color: HONEY, transform: `scale(${interpolate(t2, [0, 1], [0.8, 1])})`, opacity: Math.min(1, t2 * 1.5) }}>앞 글자부터 확인!</div>
      </div>
      <div style={{ position: "absolute", top: 1170, transform: `scale(${pill})`, opacity: Math.min(1, pill * 1.5) }}>
        <span style={{ background: HONEY, color: INK, fontFamily: DISPLAY, fontSize: 64, padding: "22px 54px", borderRadius: 60 }}>{handle} 팔로우</span>
      </div>
    </Fill>
  );
};

export const Explainer: React.FC<Props> = ({ lines, handle }) => {
  const frame = useCurrentFrame();
  const talk = useTalk(lines);
  useFonts(`${lines.map((l) => l.text).join("")}포장지 날짜 앞 글자 바뀐 거 아세요 두부 냉장 보관 유통기한 소비기한 2023년 1월 1일부터 뭐가 달라요 팔아도 되는 먹어도 안전한 단 적힌 방법을 지켰을 때 만든 날 품질이 변하는
    같은 식품 길어진 식약처 참고값 과자 일 진짜 마지막 지나면 먹지 않기 꼭 지키기 참고로 우유 냉장 2031년 부터 바뀌어요 오늘 냉장고 열고 확인 팔로우 출처 식품의약품안전처 통상적인 기준 실제 제품마다 다름 0123456789.~%→=■,!?()${handle}`);
  const cur = lines.find((l) => frame >= l.from && frame < l.from + l.frames + 12) ?? lines[lines.length - 1];
  const light = ["diff", "milk"].includes(cur?.id ?? "");      // 밝은 배경 장면에서는 계정 표시를 어둡게
  return (
    <Fill style={{ background: DARK, fontFamily: BODY }}>
      <Scenes lines={lines} render={(l, i) => {
        if (l.id === "hook") return <Hook line={l} talk={talk} />;
        if (l.id === "change") return <Change line={l} />;
        if (l.id === "diff") return <Diff line={l} />;
        if (l.id === "longer") return <Longer line={l} />;
        if (l.id === "last") return <Last line={l} />;
        if (l.id === "milk") return <Milk line={l} />;
        return <Outro line={l} talk={talk} handle={handle} />;
      }} />
      <Voice lines={lines} />
      <Captions lines={lines} />
      <Chrome handle={handle} total={totalFrames({ lines, handle })} dark={!light} />
    </Fill>
  );
};

// 미리 보기용 기본값 (실제 길이는 make.mjs가 음성을 재서 넣음)
const demo: Props = { handle: "@sebaggul", lines: ["hook", "change", "diff", "longer", "last", "milk", "outro"].map((id, i) => ({ id, text: id, audio: null, from: i * 120, frames: 110, words: [] })) };
export const Root: React.FC = () => (
  <Composition id="Explainer" component={Explainer} width={W} height={H} fps={FPS} durationInFrames={totalFrames(demo)} defaultProps={demo}
    calculateMetadata={({ props }) => ({ durationInFrames: totalFrames(props) })} />
);
