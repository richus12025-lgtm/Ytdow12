FROM node:22-bookworm

WORKDIR /app

RUN apt-get update && \
    apt-get install -y \
      ffmpeg \
      chromium \
      ca-certificates \
      fonts-liberation \
      && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./

RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
ENV CHROME_BIN=/usr/bin/chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 10000

CMD ["node", "server.js"]
