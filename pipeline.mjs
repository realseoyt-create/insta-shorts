// 한 번 실행용 (관리 화면 서버 없이 쓸 때)
//   node pipeline.mjs            수집 + 영상 1건 제작 → 승인 대기
//   node pipeline.mjs --collect  수집만
//   node pipeline.mjs --dry      예시 대본으로 영상만 렌더 (API 키 불필요, 음성은 인터넷 필요)
import { collect, runDaily, render, SAMPLE, log } from "./lib.mjs";

const args = process.argv.slice(2);
const main = async () => {
  if (args.includes("--dry")) return log("완료:", await render(SAMPLE, "dry-run"));
  if (args.includes("--collect")) return collect();
  await runDaily();
};
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
