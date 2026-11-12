import React, { useEffect, useState } from "react";
import {
  AbsoluteFill, Audio, Loop, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig,
} from "remotion";
import { Bee, HONEY, INK } from "./Bee";
import { layoutCaptions, Word } from "./captions";

export type { Word };
export type Scene = {
  kind: "hook" | "tip" | "cta";
  label?: string;          // 팁 장면 위에 뜨는 제목
  index?: number;          // 팁 번호
  words: Word[];           // 음성에 맞춘 자막
  frames: number;          // 장면 길이
  audio?: string | null;   // public 기준 경로
  bg?: string | null;      // 배경 영상 (없으면 그래픽 배경)
  own?: boolean;           // 직접 찍은 영상이 배경인 장면
  light?: boolean;         // 직접 촬영 영상용 밝은 스타일 (영상을 가리지 않고 손글씨 자막)
  bgSeconds?: number | null; // 직접 찍은 영상 길이 (내레이션 길이에 맞춰 속도 조절·반복)
};
export type ShortsProps = { scenes: Scene[]; handle: string; mascot?: string; bgm?: string | null; total?: number };

export const FPS = 30;
export const durationFor = (p: ShortsProps) => Math.max(1, p.scenes.reduce((a, s) => a + s.frames, 0));

// 세바꿀 꿀 테마: 따뜻한 검정 + 꿀 노랑
export const DARK = "#17110A";
const ORANGE = "#FF8A00";
export const BODY = "Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
export const DISPLAY = `Jua, ${BODY}`;
const HAND = `Gaegu, ${DISPLAY}`;      // 직접 촬영 영상의 손글씨 자막
export const CREAM = "#FFF3CF";
const FONT_CSS = [
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css",
  "https://fonts.googleapis.com/css2?family=Jua&family=Gaegu:wght@700&display=swap",
];

// 글꼴을 다 받은 뒤에 화면을 찍도록 기다림 (8초 넘으면 기본 글꼴로 진행)
let fontsReady: Promise<unknown> | null = null;
function loadFonts(text: string) {
  const css = (href: string) => new Promise<void>((done) => {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.onload = () => done(); l.onerror = () => done();
    document.head.appendChild(l);
  });
  fontsReady ??= Promise.all(FONT_CSS.map(css)).then(() => Promise.all([
    document.fonts.load("400 80px Jua", text), document.fonts.load("700 80px Gaegu", text), document.fonts.load("800 80px Pretendard", text), document.fonts.load("700 80px Pretendard", text),
  ]));
  return fontsReady;
}
export function useFonts(text: string) {
  const [handle] = useState(() => delayRender("글꼴 불러오기"));
  useEffect(() => {
    let done = false;
    const go = () => { if (!done) { done = true; continueRender(handle); } };
    const timer = setTimeout(go, 8000);
    loadFonts(text).then(go, go);
    return () => clearTimeout(timer);
  }, [handle, text]);
}


export const Honeycomb: React.FC = () => (
  <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
    <defs>
      <pattern id="honeycomb" width="168" height="97" patternUnits="userSpaceOnUse" patternTransform="scale(1.5)">
        <path d="M28 0 L84 0 L112 48.5 L84 97 L28 97 L0 48.5 Z M112 48.5 L168 48.5" fill="none" stroke={HONEY} strokeOpacity=".13" strokeWidth="2" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#honeycomb)" />
  </svg>
);

const Background: React.FC<{ scene: Scene; seed: number }> = ({ scene, seed }) => {
  const frame = useCurrentFrame();
  if (scene.bg) {
    const sceneSec = scene.frames / FPS;
    // 직접 찍은 영상: 내레이션보다 길면 빠르게(최대 2.5배), 짧으면 살짝 느리게 한 뒤 모자라면 반복
    const rate = scene.bgSeconds ? Math.min(2.5, Math.max(0.75, scene.bgSeconds / sceneSec)) : 1;
    const loopFrames = scene.bgSeconds ? Math.max(10, Math.floor((scene.bgSeconds / rate) * FPS) - 2) : 0;
    const zoom = scene.own ? 1 : interpolate(frame, [0, scene.frames], [1.04, 1.14]);
    const video = <OffthreadVideo src={staticFile(scene.bg)} muted playbackRate={rate}
      style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})` }} />;
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        {loopFrames && loopFrames < scene.frames ? <Loop durationInFrames={loopFrames}>{video}</Loop> : video}
        <AbsoluteFill style={{ background: scene.own
          ? "linear-gradient(180deg, rgba(0,0,0,.2) 0%, rgba(0,0,0,0) 16%)"          // 직접 찍은 영상은 거의 가리지 않음
          : "linear-gradient(180deg, rgba(20,13,5,.6) 0%, rgba(20,13,5,.38) 35%, rgba(20,13,5,.82) 100%)" }} />
      </AbsoluteFill>
    );
  }
  if (scene.light) return <AbsoluteFill style={{ background: CREAM, overflow: "hidden" }}><Honeycomb /></AbsoluteFill>;
  const drift = (k: number) => Math.sin((frame + seed * 40) / (50 + k * 13)) * 60;
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 900, height: 900, borderRadius: "50%", background: HONEY, opacity: 0.2, filter: "blur(130px)", left: -280 + drift(1), top: 120 + drift(2) }} />
      <div style={{ position: "absolute", width: 800, height: 800, borderRadius: "50%", background: ORANGE, opacity: 0.2, filter: "blur(140px)", right: -320 + drift(3), bottom: 80 + drift(4) }} />
      <Honeycomb />
    </AbsoluteFill>
  );
};

// instant: 영상의 맨 첫 장면이면 첫 문구를 0초부터 바로 보여 줌 (첫 1초 안에 읽혀야 넘기지 않음)
const Captions: React.FC<{ scene: Scene; instant?: boolean }> = ({ scene, instant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const light = Boolean(scene.light), onCream = light && !scene.bg;
  const big = scene.kind !== "tip" && !light;
  // 한 줄에 들어가는 글자 수를 글자 크기로 계산해, 묶음과 줄바꿈을 미리 정함 (화면이 알아서 줄을 바꾸게 두지 않음)
  const size = light ? 132 : big ? 136 : 104, GAP = 26;
  // 첫 문구는 표지로 쓰이므로 되도록 한 화면에 다 보이게 (세 줄까지)
  const ps = layoutCaptions(scene.words, (1080 - 140) / size, GAP / size, scene.kind === "hook" ? { maxLines: 3, whole: true } : {});
  const page = ps.find((p) => ms < p.words[p.words.length - 1].endMs) ?? ps[ps.length - 1];
  if (!page) return null;
  const pageStart = Math.round((page.words[0].startMs / 1000) * fps);
  const pop = instant && page === ps[0] ? 1 : spring({ frame: frame - pageStart, fps, config: { damping: 14, stiffness: 220, mass: 0.6 } });
  const hook = scene.kind === "hook";     // 첫 문구는 아직 안 읽은 낱말도 흐리게 하지 않고 처음부터 또렷하게
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", padding: "0 70px",
      fontFamily: light ? HAND : scene.kind === "tip" ? BODY : DISPLAY, fontSize: size * page.fit,
      fontWeight: light ? 700 : scene.kind === "tip" ? 800 : 400,
      lineHeight: 1.22, textAlign: "center", whiteSpace: "nowrap",
      transform: `scale(${interpolate(pop, [0, 1], [0.86, 1])})`, opacity: Math.min(1, pop * 1.5),
      textShadow: onCream ? "none" : light ? "0 4px 18px rgba(0,0,0,.65), 0 0 6px rgba(0,0,0,.45)" : "0 6px 24px rgba(0,0,0,.6)",
      WebkitTextStroke: light ? "0" : "2px rgba(0,0,0,.3)", wordSpacing: light ? "-0.18em" : undefined,
    }}>
      {page.lines.map((line, li) => (
        <div key={li} style={{ display: "flex", justifyContent: "center", gap: GAP * page.fit }}>
          {line.map((w, i) => {
            const on = ms >= w.startMs;
            const now = on && ms < w.endMs;
            if (light) return <span key={i} style={{ color: onCream ? INK : "#fff" }}>{w.text}</span>;   // 밝은 스타일: 짧은 구절을 한 번에 보여 줌
            return <span key={i} style={{ color: now ? HONEY : on || hook ? "#fff" : "rgba(255,255,255,.45)", transform: now ? "translateY(-6px)" : "none" }}>{w.text}</span>;
          })}
        </div>
      ))}
    </div>
  );
};

const GLOW = "drop-shadow(0 0 5px rgba(255,255,255,.95)) drop-shadow(0 0 2px rgba(255,255,255,.95))";   // 어두운 배경에서도 윤곽이 보이게
const HEX ="polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%)";

const SceneView: React.FC<{ scene: Scene; seed: number; total: number; handle: string; mascot: string }> = ({ scene, seed, total, handle, mascot }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const pop = spring({ frame: frame - 4, fps, config: { damping: 11, stiffness: 160 } });
  const fadeIn = seed === 0 ? 1 : interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" });   // 첫 장면은 표지로 쓰이므로 바로 보이게
  const bob = Math.sin(frame / 9) * 14;
  const light = Boolean(scene.light);
  // 음성이 나오는 동안 바꿀이 입이 움직임
  const ms = (frame / fps) * 1000;
  const talk = scene.words.some((w) => ms >= w.startMs && ms < w.endMs) ? 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.85)) : 0;
  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <Background scene={scene} seed={seed} />
      {scene.audio && <Audio src={staticFile(scene.audio)} />}
      {scene.kind === "tip" && !light && (
        <div style={{ position: "absolute", top: 250, left: 60, right: 70, display: "flex", alignItems: "center", gap: 26,
          opacity: enter, transform: `translateX(${interpolate(enter, [0, 1], [-80, 0])}px)` }}>
          <div style={{ minWidth: 150, height: 136, clipPath: HEX, background: HONEY, color: INK, fontFamily: DISPLAY, fontSize: 84,
            display: "flex", alignItems: "center", justifyContent: "center" }}>{scene.index}</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 74, color: "#fff", lineHeight: 1.18, wordBreak: "keep-all", textShadow: "0 4px 18px rgba(0,0,0,.6)" }}>{scene.label}</div>
        </div>
      )}
      {scene.kind !== "tip" && !scene.own && (
        <div style={{ position: "absolute", top: scene.kind === "cta" ? 330 : 300, left: 0, right: 0, display: "flex", justifyContent: "center",
          transform: `translateY(${bob}px) scale(${pop})` }}>
          <Bee size={scene.kind === "cta" ? 400 : 320} frame={frame} talk={talk} style={{ filter: GLOW }} />
        </div>
      )}
      {/* 꿀팁 장면: 바꿀이가 왼쪽 아래에서 말하는 진행자로 등장 */}
      {scene.kind === "tip" && !light && (
        <div style={{ position: "absolute", left: 46, bottom: 400, transform: `translateY(${bob * 0.6}px) scale(${pop})`, transformOrigin: "bottom left" }}>
          <Bee size={220} frame={frame} talk={talk} style={{ filter: GLOW }} />
        </div>
      )}
      {/* 마지막 화면: 캐릭터 이름표 */}
      {scene.kind === "cta" && !scene.own && mascot && (
        <div style={{ position: "absolute", top: 760, left: 0, right: 0, textAlign: "center", opacity: enter }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 50, color: HONEY, border: `4px solid ${HONEY}`, borderRadius: 50, padding: "8px 34px", background: "rgba(23,17,10,.7)" }}>{mascot}</span>
        </div>
      )}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center",
        paddingTop: light ? (scene.kind === "cta" ? 420 : scene.kind === "hook" ? 0 : 200) : scene.kind === "tip" ? 120 : 160 }}>
        {scene.kind === "hook" && light ? (
          // 직접 촬영 영상의 첫 화면 = 표지: 반투명 흰 상자에 손글씨 제목
          <div style={{ margin: "0 64px", padding: "46px 56px 54px", background: "rgba(255,255,255,.76)", fontFamily: HAND, fontWeight: 700, fontSize: 150,
            lineHeight: 1.16, color: "#151515", textAlign: "center", wordBreak: "keep-all", wordSpacing: "-0.18em" }}>{scene.words.map((w) => w.text).join(" ")}</div>
        ) : <Captions scene={scene} instant={seed === 0} />}
      </AbsoluteFill>
      {scene.kind === "tip" && total > 1 && !light && (
        <div style={{ position: "absolute", bottom: 330, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16 }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} style={{ width: i + 1 === scene.index ? 70 : 22, height: 22, borderRadius: 11, background: i + 1 === scene.index ? HONEY : "rgba(255,255,255,.4)" }} />
          ))}
        </div>
      )}
      {scene.kind === "cta" && (
        <div style={{ position: "absolute", bottom: 420, left: 0, right: 0, textAlign: "center", opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [50, 0])}px)` }}>
          <span style={{ background: HONEY, color: INK, fontFamily: DISPLAY, fontSize: 64, padding: "22px 54px", borderRadius: 60 }}>{handle} 팔로우</span>
        </div>
      )}
    </AbsoluteFill>
  );
};

export const Shorts: React.FC<ShortsProps> = ({ scenes, handle, mascot = "", bgm }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  useFonts(scenes.map((s) => `${s.label ?? ""}${s.words.map((w) => w.text).join("")}`).join("") + handle + mascot + "가 직접 해 봤어요 팔로우0123456789");
  const total = scenes.filter((s) => s.kind === "tip").length;
  let t = 0;
  return (
    <AbsoluteFill style={{ fontFamily: BODY, background: DARK }}>
      {bgm && <Audio src={staticFile(bgm)} volume={0.12} loop />}
      {scenes.map((s, i) => {
        const from = t; t += s.frames;
        return <Sequence key={i} from={from} durationInFrames={s.frames}><SceneView scene={s} seed={i} total={total} handle={handle} mascot={mascot} /></Sequence>;
      })}
      <div style={{ position: "absolute", top: 0, left: 0, height: 12, background: HONEY, width: `${(frame / durationInFrames) * 100}%` }} />
      <div style={{ position: "absolute", top: 108, right: 56, display: "flex", alignItems: "center", gap: 10, fontSize: 38, fontWeight: 700,
        color: "#fff", textShadow: "0 2px 10px rgba(0,0,0,.7), 0 0 3px rgba(0,0,0,.6)" }}>
        <Bee size={62} style={{ filter: "drop-shadow(0 0 3px rgba(255,255,255,.9))" }} />{handle}
      </div>
    </AbsoluteFill>
  );
};
