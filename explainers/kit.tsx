// 설명형 쇼츠 공통 부품: 편마다 화면은 새로 그리되, 소리 맞추기·자막·세바꿀 표시는 여기 것을 같이 씀
import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { Bee, HONEY, INK } from "../src/Bee";
import { BODY, DISPLAY } from "../src/Shorts";
import { layoutCaptions, Word } from "../src/captions";

export const FPS = 30;
export const W = 1080, H = 1920;
export const DARK = "#17110A", CREAM = "#FAF6EC", CORAL = "#FF6B4A";
export { HONEY, INK, BODY, DISPLAY, Bee };

// make.mjs가 음성 길이를 재서 만들어 주는 값
//   lead: 장면이 시작되고 몇 프레임 뒤에 목소리가 나오는지 (첫 장면은 0프레임부터 화면이 보여야 표지가 됨)
export type Line = { id: string; text: string; audio: string | null; from: number; frames: number; words: Word[]; caption?: boolean; lead?: number };
export type Props = { lines: Line[]; handle: string };
export const totalFrames = (p: Props) => Math.max(1, ...p.lines.map((l) => l.from + l.frames));

// 그 줄에서 낱말(substr가 들어간 첫 낱말)을 말하기 시작하는 시점 (줄 시작 기준 프레임). 못 찾으면 0
export const cue = (line: Line, substr: string) => {
  const w = line.words.find((x) => x.text.includes(substr));
  return w ? Math.round((w.startMs / 1000) * FPS) : 0;
};
export const pop = (frame: number, delay = 0, damping = 13) => spring({ frame: frame - delay, fps: FPS, config: { damping, stiffness: 170, mass: 0.7 } });
export const ease = (frame: number, from: number, to: number) => interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// 줄마다 장면 하나: 다음 줄이 시작할 때까지 화면을 유지
export const Scenes: React.FC<{ lines: Line[]; render: (line: Line, index: number) => React.ReactNode }> = ({ lines, render }) => (<>
  {lines.map((l, i) => {
    const end = i + 1 < lines.length ? lines[i + 1].from : l.from + l.frames;
    return <Sequence key={l.id} from={l.from} durationInFrames={end - l.from}>{render(l, i)}</Sequence>;
  })}
</>);

export const Voice: React.FC<{ lines: Line[] }> = ({ lines }) => (<>
  {lines.filter((l) => l.audio).map((l) => <Sequence key={l.id} from={l.from + (l.lead ?? 0)} durationInFrames={l.frames}><Audio src={staticFile(l.audio!)} /></Sequence>)}
</>);

// 자막: 화면 아래쪽(인스타 단추에 가리지 않는 높이)에 한두 줄. 말하는 낱말만 꿀색
export const Captions: React.FC<{ lines: Line[]; bottom?: number }> = ({ lines, bottom = 440 }) => {
  const frame = useCurrentFrame();
  const line = lines.find((l) => frame >= l.from && frame < l.from + l.frames);
  if (!line || line.caption === false) return null;
  const ms = ((frame - line.from) / FPS) * 1000, size = 58, GAP = 16;
  const pages = layoutCaptions(line.words, 880 / size, GAP / size);
  const page = pages.find((p) => ms < p.words[p.words.length - 1].endMs) ?? pages[pages.length - 1];
  if (!page) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom, display: "flex", justifyContent: "center" }}>
      <div style={{ background: "rgba(23,17,10,.86)", borderRadius: 28, padding: "18px 34px", fontFamily: BODY, fontWeight: 800, fontSize: size * page.fit, lineHeight: 1.3,
        whiteSpace: "nowrap", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {page.lines.map((ws, i) => (
          <div key={i} style={{ display: "flex", gap: GAP * page.fit }}>
            {ws.map((w, k) => <span key={k} style={{ color: ms >= w.startMs && ms < w.endMs ? HONEY : "#fff" }}>{w.text}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
};

// 지금 말하는 중인지 (바꿀이 입 모양용, 0~1)
export const useTalk = (lines: Line[]) => {
  const frame = useCurrentFrame();
  const line = lines.find((l) => frame >= l.from && frame < l.from + l.frames);
  if (!line) return 0;
  const ms = ((frame - line.from) / FPS) * 1000;
  return line.words.some((w) => ms >= w.startMs && ms < w.endMs) ? 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.85)) : 0;
};

// 위쪽 진행 막대와 계정 표시 (평소 영상과 같은 모양)
export const Chrome: React.FC<{ handle: string; total: number; dark?: boolean }> = ({ handle, total, dark = true }) => {
  const frame = useCurrentFrame();
  return (<>
    <div style={{ position: "absolute", top: 0, left: 0, height: 12, background: HONEY, width: `${(frame / total) * 100}%` }} />
    <div style={{ position: "absolute", top: 108, right: 56, display: "flex", alignItems: "center", gap: 10, fontFamily: BODY, fontSize: 38, fontWeight: 700,
      color: dark ? "#fff" : INK, textShadow: dark ? "0 2px 10px rgba(0,0,0,.7)" : "none" }}>
      <Bee size={62} style={dark ? { filter: "drop-shadow(0 0 3px rgba(255,255,255,.9))" } : undefined} />{handle}
    </div>
  </>);
};

// 출처 표시: 숫자나 인용이 나오는 화면에 같이 둠
export const Source: React.FC<{ text: string; dark?: boolean; bottom?: number }> = ({ text, dark = true, bottom = 690 }) => (
  <div style={{ position: "absolute", left: 0, right: 0, bottom, textAlign: "center", fontFamily: BODY, fontSize: 32, fontWeight: 600,
    color: dark ? "rgba(255,255,255,.62)" : "rgba(43,29,14,.6)" }}>출처: {text}</div>
);

export const Fill = AbsoluteFill;
