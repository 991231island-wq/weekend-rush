FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY . .

ENV HOST=0.0.0.0 \
    PORT=7860 \
    AI_ONLY_MODE=1 \
    APP_STATE_DIR=/mnt/workspace/weekend-rush-state
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:7860/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "scripts/serve-live.mjs"]
