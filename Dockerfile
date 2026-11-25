FROM node:24-bookworm

ENV PYTHONUNBUFFERED=1 \
    COREPACK_HOME=/tmp/corepack

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg imagemagick fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages --no-cache-dir yt-dlp

RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --prod=false \
    && pnpm --filter @workspace/n3xus run build \
    && pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production \
    PORT=10000
EXPOSE 10000
CMD ["sh", "./start.sh"]
