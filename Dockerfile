FROM node:24-alpine

WORKDIR /app
COPY --chown=65532:65532 package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=65532:65532 src ./src
COPY --chown=65532:65532 case-data ./case-data
RUN mkdir -p /state && chown 65532:65532 /state && chmod 0700 /state

ENV NODE_ENV=production
ENV PORT=8080
ENV CORPUS_PATH=/app/case-data
ENV RUNTIME_STATE_PATH=/state
ENV INDEX_PATH=/state
EXPOSE 8080

USER 65532:65532

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/readyz || exit 1

CMD ["node", "src/server.ts"]
