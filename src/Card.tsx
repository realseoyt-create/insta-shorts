import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Bee, HONEY, INK } from "./Bee";
import { BODY, CREAM, DARK, DISPLAY, Honeycomb, useFonts } from "./Shorts";

// 카드뉴스 한 장 (1080x1350). kind: cover(표지) | card(내용) | end(마무리)
export type CardProps = {
  kind: "cover" | "card" | "end";
  title: string;
  body?: string;
  index?: number;          // 내용 카드 번호
  total?: number;          // 내용 카드 수
  shot?: string | null;    // 사이트 화면 사진 (public 기준 경로)
  photo?: string | null;   // 내용에 맞는 사진 (표지에서는 배경 사진)
  site?: string;           // 사진 위에 적을 주소
  full?: boolean;          // 사이트 화면을 장 전체에 꽉 채우는 모양 (사이트 추천용)
  handle: string;
  mascot?: string;
};

const HEX = "polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%)";
const Footer: React.FC<{ handle: string; dark?: boolean }> = ({ handle, dark }) => (
  <div style={{ position: "absolute", left: 70, right: 70, bottom: 56, display: "flex", alignItems: "center", gap: 12, fontSize: 34, fontWeight: 700,
    color: dark ? "rgba(255,255,255,.85)" : "rgba(43,29,14,.7)" }}>
    <Bee size={58} style={dark ? { filter: "drop-shadow(0 0 3px rgba(255,255,255,.9))" } : undefined} />{handle}
  </div>
);

export const Card: React.FC<CardProps> = ({ kind, title, body, index, total, shot, photo, site, full, handle, mascot }) => {
  useFonts(`${title}${body ?? ""}${site ?? ""}${handle}${mascot ?? ""}옆으로 넘겨 보세요 저장해 두면 꿀 팔로우 0123456789/`);
  if (kind === "cover") {
    return (
      <AbsoluteFill style={{ background: DARK, fontFamily: BODY, overflow: "hidden" }}>
        {photo ? (<>
          {/* 사진 표지: 사진을 꽉 채우고, 글자가 읽히도록 위아래를 어둡게 */}
          <Img src={staticFile(photo)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover" }} />
          <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(20,13,5,.86) 0%, rgba(20,13,5,.62) 48%, rgba(20,13,5,.2) 70%, rgba(20,13,5,.78) 100%)" }} />
        </>) : (<>
          <div style={{ position: "absolute", width: 900, height: 900, borderRadius: "50%", background: HONEY, opacity: 0.22, filter: "blur(130px)", left: -300, top: -200 }} />
          <div style={{ position: "absolute", width: 800, height: 800, borderRadius: "50%", background: "#FF8A00", opacity: 0.2, filter: "blur(140px)", right: -320, bottom: -150 }} />
          <Honeycomb />
        </>)}
        <div style={{ position: "absolute", top: 90, left: 70, background: HONEY, color: INK, fontFamily: DISPLAY, fontSize: 40, padding: "10px 30px", borderRadius: 40 }}>세바꿀 꿀팁</div>
        <div style={{ position: "absolute", top: 250, left: 70, right: 70 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 128, lineHeight: 1.18, color: "#fff", wordBreak: "keep-all", textShadow: photo ? "0 6px 26px rgba(0,0,0,.7)" : "none" }}>{title}</div>
          {body && <div style={{ marginTop: 40, fontSize: 50, fontWeight: 700, lineHeight: 1.4, color: HONEY, wordBreak: "keep-all", textShadow: photo ? "0 3px 14px rgba(0,0,0,.8)" : "none" }}>{body}</div>}
        </div>
        <Bee size={330} style={{ position: "absolute", right: 60, bottom: 130, filter: "drop-shadow(0 0 5px rgba(255,255,255,.95))" }} />
        <div style={{ position: "absolute", left: 70, bottom: 150, fontFamily: DISPLAY, fontSize: 42, color: "rgba(255,255,255,.85)" }}>옆으로 넘겨 보세요 →</div>
        <Footer handle={handle} dark />
      </AbsoluteFill>
    );
  }
  if (kind === "end") {
    return (
      <AbsoluteFill style={{ background: CREAM, fontFamily: BODY, alignItems: "center", overflow: "hidden" }}>
        <Honeycomb />
        <Bee size={420} style={{ marginTop: 170, position: "relative" }} />
        {mascot && <div style={{ marginTop: 6, fontFamily: DISPLAY, fontSize: 46, color: HONEY, background: INK, borderRadius: 50, padding: "6px 34px", position: "relative" }}>{mascot}</div>}
        <div style={{ margin: "60px 80px 0", fontFamily: DISPLAY, fontSize: 92, lineHeight: 1.25, color: INK, textAlign: "center", wordBreak: "keep-all", position: "relative" }}>{title}</div>
        <div style={{ position: "absolute", bottom: 170, background: HONEY, color: INK, fontFamily: DISPLAY, fontSize: 60, padding: "20px 56px", borderRadius: 60 }}>{handle} 팔로우</div>
      </AbsoluteFill>
    );
  }
  // 사이트 추천용: 사이트 화면을 꽉 채우고, 아래 흰 상자에 설명을 넣고, 제목을 그 위에 스티커처럼 얹음
  if (full && shot) {
    return (
      <AbsoluteFill style={{ background: "#fff", fontFamily: BODY, overflow: "hidden" }}>
        <Img src={staticFile(shot)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
        <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(20,13,5,.38) 0%, rgba(20,13,5,0) 14%, rgba(20,13,5,0) 60%, rgba(20,13,5,.5) 100%)" }} />
        <div style={{ position: "absolute", top: 50, left: 50, right: 50, display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ minWidth: 104, height: 94, clipPath: HEX, background: HONEY, color: INK, fontFamily: DISPLAY, fontSize: 58, display: "flex", alignItems: "center", justifyContent: "center" }}>{index}</div>
          {site && <div style={{ background: "rgba(28,21,9,.88)", color: "#fff", fontSize: 32, fontWeight: 700, padding: "12px 26px", borderRadius: 40, maxWidth: 760, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{site}</div>}
          <div style={{ marginLeft: "auto", background: "rgba(28,21,9,.7)", color: "#fff", fontSize: 30, fontWeight: 700, padding: "10px 20px", borderRadius: 30 }}>{index}/{total}</div>
        </div>
        <div style={{ position: "absolute", left: 56, right: 56, bottom: 150 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: title.length <= 8 ? 112 : title.length <= 12 ? 94 : 84, lineHeight: 1.1, color: HONEY, textAlign: "center", wordBreak: "keep-all", textWrap: "balance",
            WebkitTextStroke: `22px ${INK}`, paintOrder: "stroke fill",
            position: "relative", zIndex: 2, marginBottom: -34, padding: "0 20px" }}>{title}</div>
          <div style={{ background: "#fff", border: `5px solid ${INK}`, borderRadius: 60, padding: "70px 50px 46px", fontSize: 46, fontWeight: 700, lineHeight: 1.5, color: INK, textAlign: "center",
            wordBreak: "keep-all", boxShadow: "0 12px 0 rgba(28,21,9,.25)" }}>{body}</div>
        </div>
        <Footer handle={handle} dark />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: CREAM, fontFamily: BODY, overflow: "hidden" }}>
      <Honeycomb />
      <div style={{ position: "absolute", top: 80, left: 64, right: 70, display: "flex", alignItems: "center", gap: 26 }}>
        <div style={{ minWidth: 140, height: 126, clipPath: HEX, background: HONEY, color: INK, fontFamily: DISPLAY, fontSize: 78, display: "flex", alignItems: "center", justifyContent: "center" }}>{index}</div>
        <div style={{ flex: 1, fontFamily: DISPLAY, fontSize: 76, lineHeight: 1.2, color: INK, wordBreak: "keep-all" }}>{title}</div>
        <div style={{ fontSize: 34, fontWeight: 700, color: "rgba(43,29,14,.5)", alignSelf: "flex-start" }}>{index}/{total}</div>
      </div>
      {/* 사진이 없는 장은 글을 가운데에 크게 두고 아래에 바꿀이를 넣어 빈 곳을 채움 */}
      {!shot && !photo && <Bee size={250} style={{ position: "absolute", right: 70, bottom: 130 }} />}
      <div style={{ position: "absolute", top: shot || photo ? 290 : 270, left: 70, right: 70, bottom: shot || photo ? 150 : 400, display: "flex", flexDirection: "column", gap: 34,
        justifyContent: shot || photo ? "flex-start" : "center" }}>
        {/* 내용에 맞는 사진: 장의 절반 가까이를 사진으로 */}
        {!shot && photo && (
          <div style={{ borderRadius: 30, border: `5px solid ${INK}`, overflow: "hidden", background: "#fff", boxShadow: "0 14px 0 rgba(43,29,14,.12)" }}>
            <Img src={staticFile(photo)} style={{ width: "100%", height: 560, objectFit: "cover", display: "block" }} />
          </div>
        )}
        {!shot && !photo && site && (
          <div style={{ alignSelf: "flex-start", background: INK, color: "#fff", fontSize: 38, fontWeight: 700, padding: "12px 30px", borderRadius: 40,
            display: "flex", alignItems: "center", gap: 14 }}><span style={{ width: 18, height: 18, borderRadius: 9, background: HONEY }} />{site}</div>
        )}
        {shot && (
          <div style={{ borderRadius: 26, border: `5px solid ${INK}`, overflow: "hidden", background: "#fff", boxShadow: "0 14px 0 rgba(43,29,14,.12)" }}>
            {site && (
              <div style={{ background: INK, color: "#fff", fontSize: 30, fontWeight: 700, padding: "12px 24px", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 18, height: 18, borderRadius: 9, background: HONEY }} />{site}
              </div>
            )}
            <Img src={staticFile(shot)} style={{ width: "100%", height: 480, objectFit: "cover", objectPosition: "top", display: "block" }} />
          </div>
        )}
        <div style={{ background: "#fff", borderRadius: 30, padding: shot || photo ? "32px 44px" : "60px 56px", fontSize: shot || photo ? 45 : 60, fontWeight: 700, lineHeight: 1.5,
          color: INK, wordBreak: "keep-all", whiteSpace: "pre-wrap", boxShadow: "0 10px 0 rgba(43,29,14,.08)" }}>{body}</div>
      </div>
      <Footer handle={handle} />
    </AbsoluteFill>
  );
};
