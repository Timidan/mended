FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
ENV DB_PATH=/data/mended.sqlite

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY data/seed-fixes.json ./data/seed-fixes.json

RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4317

CMD ["node", "--no-warnings", "src/server.mjs"]
