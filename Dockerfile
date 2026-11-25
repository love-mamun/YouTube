FROM node:24-bookworm

ENV PYTHONUNBUFFERED=1 \
    COREPACK_HOME=/tmp/corepack \
    BGUTIL_SERVER_HOME=/opt/bgutil-ytdlp-pot-provider/server \
    BGUTIL_POT_URL=http://127.0.0.1:4416

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip git ffmpeg imagemagick fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages --no-cache-dir -U "yt-dlp[default]" yt-dlp-ejs bgutil-ytdlp-pot-provider \
    && git clone --single-branch --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider \
    && cd /opt/bgutil-ytdlp-pot-provider/server \
    && npm ci \
    && npx tsc

WORKDIR /app
COPY . .
RUN npm install --include=dev \
    && npm run build --workspace=artifacts/n3xus \
    && npm run build --workspace=artifacts/api-server

ENV NODE_ENV=production \
    PORT=10000
EXPOSE 10000
CMD ["sh", "./start.sh"]
