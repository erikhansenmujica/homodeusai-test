FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM dependencies AS model-assets

ARG MATERIALIZE_E5=true
COPY scripts/materialize-model.ts ./scripts/
COPY src/model-manifest.ts ./src/
RUN mkdir -p /app/models \
  && if [ "$MATERIALIZE_E5" = "true" ]; then \
       node scripts/materialize-model.ts; \
     fi

FROM dependencies AS retrieval-assets

ARG MATERIALIZE_E5=true
COPY --from=model-assets /app/models ./models
COPY scripts/build-semantic-index.ts ./scripts/
COPY src/corpus.ts src/learned-semantic.ts src/model-manifest.ts src/retrieval.ts src/types.ts ./src/
COPY case-data ./case-data
RUN mkdir -p /app/artifacts \
  && if [ "$MATERIALIZE_E5" = "true" ]; then \
       node scripts/build-semantic-index.ts; \
     fi

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
COPY --from=dependencies --chown=65532:65532 /app/node_modules ./node_modules
COPY --chown=65532:65532 package.json package-lock.json ./
COPY --chown=65532:65532 src ./src
COPY --chown=65532:65532 config ./config
COPY --chown=65532:65532 case-data ./case-data
COPY --from=model-assets --chown=65532:65532 /app/models ./models
COPY --from=retrieval-assets --chown=65532:65532 /app/artifacts ./artifacts
RUN mkdir -p /state && chown 65532:65532 /state && chmod 0700 /state

ENV NODE_ENV=production
ENV PORT=8080
ENV CORPUS_PATH=/app/case-data
ENV RUNTIME_STATE_PATH=/state
ENV INDEX_PATH=/state
ENV BUNDLED_SEMANTIC_INDEX_PATH=/app/artifacts/learned-semantic-index.json
ENV LEARNED_SEMANTIC_ENABLED=true
EXPOSE 8080

USER 65532:65532

HEALTHCHECK --interval=30s --timeout=3s --start-period=45s \
  CMD node -e "fetch('http://127.0.0.1:8080/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.ts"]
