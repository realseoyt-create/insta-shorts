import React from "react";
import { AbsoluteFill } from "remotion";

export const HONEY = "#FFB400";
export const INK = "#2B1D0E";

// 세바꿀 꿀벌 캐릭터. frame을 넘기면 날개가 움직입니다.
// talk(0~1)를 넘기면 그만큼 입을 벌립니다 (말하는 동안 움직이게).
export const Bee: React.FC<{ size: number; frame?: number; talk?: number; style?: React.CSSProperties }> = ({ size, frame = 0, talk = 0, style }) => {
  const flap = Math.sin(frame / 1.6) * 9;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} style={style}>
      <defs><clipPath id="beeBody"><ellipse cx="100" cy="120" rx="60" ry="54" /></clipPath></defs>
      {/* 날개 */}
      <g fill="#EAF6FF" stroke={INK} strokeWidth="5">
        <ellipse cx="60" cy="60" rx="25" ry="37" transform={`rotate(${-30 - flap} 80 90)`} />
        <ellipse cx="140" cy="60" rx="25" ry="37" transform={`rotate(${30 + flap} 120 90)`} />
      </g>
      {/* 더듬이 */}
      <g fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round">
        <path d="M86 70 Q80 48 68 40" /><path d="M114 70 Q120 48 132 40" />
      </g>
      <circle cx="66" cy="38" r="7" fill={INK} /><circle cx="134" cy="38" r="7" fill={INK} />
      {/* 침 */}
      <path d="M90 168 L110 168 L100 190 Z" fill={INK} strokeLinejoin="round" stroke={INK} strokeWidth="3" />
      {/* 몸통 + 줄무늬 */}
      <ellipse cx="100" cy="120" rx="60" ry="54" fill={HONEY} />
      <g clipPath="url(#beeBody)" fill={INK}>
        <rect x="30" y="137" width="140" height="11" /><rect x="30" y="155" width="140" height="10" />
      </g>
      <ellipse cx="88" cy="88" rx="26" ry="12" fill="#fff" opacity=".28" transform="rotate(-18 88 88)" />
      <ellipse cx="100" cy="120" rx="60" ry="54" fill="none" stroke={INK} strokeWidth="6" />
      {/* 얼굴 */}
      <circle cx="78" cy="108" r="9" fill={INK} /><circle cx="122" cy="108" r="9" fill={INK} />
      <circle cx="81" cy="105" r="3" fill="#fff" /><circle cx="125" cy="105" r="3" fill="#fff" />
      <ellipse cx="62" cy="122" rx="9" ry="6" fill="#FF7A59" opacity=".75" /><ellipse cx="138" cy="122" rx="9" ry="6" fill="#FF7A59" opacity=".75" />
      {talk > 0.1
        ? <ellipse cx="100" cy="123" rx={6 + talk * 3} ry={2 + talk * 8} fill={INK} />
        : <path d="M90 119 Q100 130 110 119" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />}
    </svg>
  );
};

// 캐릭터 이미지 내보내기용 (bg=true면 프로필용 배경 포함)
export const BeeCard: React.FC<{ bg?: boolean }> = ({ bg }) => (
  <AbsoluteFill style={{ background: bg ? "#17110A" : "transparent", alignItems: "center", justifyContent: "center" }}>
    {bg && <div style={{ position: "absolute", width: 820, height: 820, borderRadius: "50%", background: "#FFE08A" }} />}
    <Bee size={bg ? 760 : 1040} style={{ position: "relative" }} />
  </AbsoluteFill>
);
