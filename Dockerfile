# 관리 화면 + 예약 실행 + 영상 렌더를 한 컨테이너로 실행
FROM node:22-bookworm-slim

# 렌더용 크롬과 한글 글꼴
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV BROWSER_PATH=/usr/bin/chromium TZ=Asia/Seoul NODE_ENV=production PORT=3200

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# 수집한 소재(data)와 만든 영상(out)은 볼륨에 보관
VOLUME ["/app/data", "/app/out"]
EXPOSE 3200
HEALTHCHECK --interval=1m --timeout=5s CMD node -e "fetch('http://127.0.0.1:3200/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.mjs"]
