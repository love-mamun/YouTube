FROM node:24-bookworm

ENV PYTHONUNBUFFERED=1 \
    COREPACK_HOME=/tmp/corepack

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg imagemagick fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages --no-cache-dir yt-dlp

WORKDIR /app
COPY . .
RUN npm install --include=dev \
    && npm run build --workspace=artifacts/n3xus \
    && npm run build --workspace=artifacts/api-server

ENV NODE_ENV=production \
    PORT=10000
EXPOSE 10000
CMD ["sh", "./start.sh"]
