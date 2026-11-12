// 음성 합성 — 제공자를 쉽게 바꿀 수 있는 구조
// .env의 TTS_PROVIDER로 선택 (기본 edge). 새 제공자는 providers에 함수 하나만 추가하면 됩니다.
//   함수 형식: async (text, outFile) => void   (outFile 경로에 mp3를 저장)
import fs from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";

const providers = {
  // 무료: Microsoft Edge 낭독 음성 (비공식 경로 — 막히면 다른 제공자로 교체)
  async edge(text, outFile) {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS();
    // 낱말마다 정확한 시작·끝 시각도 함께 받음 → 자막을 음성에 정확히 맞추는 데 씀
    await tts.setMetadata(process.env.TTS_VOICE ?? "ko-KR-SunHiNeural", OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
    const dir = await fs.mkdtemp(path.join(path.dirname(outFile), "tts-"));
    try {
      const { audioFilePath, metadataFilePath } = await tts.toFile(dir, text, { rate: process.env.TTS_RATE ?? "+12%" });
      await fs.rename(audioFilePath, outFile);
      if (!metadataFilePath) return null;
      const meta = JSON.parse(await fs.readFile(metadataFilePath, "utf8")).Metadata ?? [];
      return meta.filter((m) => m.Type === "WordBoundary")                       // 시각 단위가 100나노초라 1만으로 나눠 밀리초로
        .map((m) => ({ text: m.Data.text.Text, startMs: m.Data.Offset / 10000, endMs: (m.Data.Offset + m.Data.Duration) / 10000 }));
    } finally { tts.close?.(); await fs.rm(dir, { recursive: true, force: true }); }
  },

  // 유료 공식 예시: Google Cloud TTS (GOOGLE_TTS_KEY 필요) — TTS_PROVIDER=google
  async google(text, outFile) {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { text }, voice: { languageCode: "ko-KR", name: process.env.TTS_VOICE ?? "ko-KR-Neural2-A" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 1.1 } }),
    });
    if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text()}`);
    await fs.writeFile(outFile, Buffer.from((await res.json()).audioContent, "base64"));
  },
};

// 반환: { file: 저장된 mp3 경로 또는 null(무음), seconds: 길이, marks: 낱말별 시각 [{text,startMs,endMs}] 또는 null }
//   제공자 함수가 낱말별 시각을 돌려주면 marks에 담김 (없으면 글자 수로 어림잡음)
export async function synth(text, outFile) {
  const name = process.env.TTS_PROVIDER ?? "edge";
  if (name !== "none") {
    const fn = providers[name];
    if (!fn) throw new Error(`알 수 없는 TTS_PROVIDER: ${name}`);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const marks = await fn(text, outFile);
        const { format } = await parseFile(outFile);
        if (format.duration > 0.2) return { file: outFile, seconds: format.duration, marks: Array.isArray(marks) && marks.length ? marks : null };
      } catch (e) { if (attempt === 2) console.warn(`음성 합성 실패(${name}) — 무음으로 진행: ${e.message}`); }
    }
  }
  return { file: null, seconds: Math.max(1.6, text.replace(/\s/g, "").length * 0.17) };   // 무음일 때 읽는 속도 추정
}
