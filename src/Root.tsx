import React from "react";
import { Composition, Still } from "remotion";
import { Shorts, ShortsProps, Scene, durationFor, FPS } from "./Shorts";
import { BeeCard } from "./Bee";
import { Card } from "./Card";

// Studio 미리보기용 예시 (음성 없이 글자 타이밍만)
const mk = (kind: Scene["kind"], text: string, extra: Partial<Scene> = {}): Scene => {
  const parts = text.split(/\s+/);
  const per = 380;
  return { kind, words: parts.map((t, i) => ({ text: t, startMs: i * per, endMs: (i + 1) * per })), frames: Math.ceil(((parts.length * per) / 1000 + 0.4) * FPS), ...extra };
};
const sample: ShortsProps = {
  handle: "@sebaggul",
  mascot: "바꿀이",
  scenes: [
    mk("hook", "냉장고 정리, 이것만 바꾸세요"),
    mk("tip", "임박한 재료는 눈높이 칸 한 곳에 모아두세요.", { index: 1, label: "먼저 먹을 칸 만들기" }),
    mk("tip", "안이 보이면 잊고 버리는 재료가 줄어듭니다.", { index: 2, label: "투명 용기로 통일" }),
    mk("cta", "저장하고 주말에 해보세요"),
  ],
};

export const Root: React.FC = () => (<>
  <Still id="Bee" component={BeeCard} width={1080} height={1080} defaultProps={{ bg: true }} />
  <Still id="Card" component={Card} width={1080} height={1350}
    defaultProps={{ kind: "card" as const, index: 1, total: 5, title: "숨은 내 돈 찾기", body: "잠자는 계좌와 포인트를 한 번에 조회할 수 있어요.", handle: "@sebaggul", mascot: "바꿀이" }} />
  <Composition
    id="Shorts"
    component={Shorts}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={durationFor(sample)}
    defaultProps={sample}
    calculateMetadata={({ props }) => ({ durationInFrames: durationFor(props) })}
  />
</>);
