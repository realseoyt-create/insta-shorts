// 서버 지킴이: 서버(server.mjs)를 켜 두고, 어떤 이유로든 꺼지면 다시 켬
//   실행:  node run.mjs      (npm start 와 같음)
//   코드를 고친 뒤 반영하려면 서버 프로세스만 끄면 됨 → 지킴이가 5초 뒤 새 코드로 다시 켬
//   완전히 끄려면 이 지킴이 프로세스를 먼저 끔
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const note = (text) => {
  const line = `${new Date().toISOString().slice(0, 10)} ${new Date().toLocaleTimeString()} [지킴이] ${text}`;
  console.log(line);
  try { mkdirSync(path.join(ROOT, "data"), { recursive: true }); appendFileSync(path.join(ROOT, "data", "server.log"), `${line}\n`); } catch { /* 기록 실패는 무시 */ }
};
let recent = [];                                     // 최근에 꺼진 시각들 (연달아 꺼지면 잠시 쉼)
function start() {
  const child = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, stdio: "inherit", windowsHide: true });
  child.on("exit", (code, signal) => {
    const now = Date.now();
    recent = [...recent.filter((t) => now - t < 120_000), now];
    const wait = recent.length >= 5 ? 60_000 : 5_000;   // 2분 안에 5번 꺼지면 1분 쉬고 다시 시도
    note(`서버가 꺼졌습니다 (종료 코드 ${code ?? signal}). ${wait / 1000}초 뒤에 다시 켭니다`);
    setTimeout(start, wait);
  });
}
note("서버를 켭니다");
start();
