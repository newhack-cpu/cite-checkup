FROM node:22.22.3-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=${NPM_REGISTRY} \
    pnpm_config_registry=${NPM_REGISTRY} \
    pnpm_config_shamefully_hoist=true
RUN npm install --global pnpm@11.22.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --shamefully-hoist
# 论断检索的向量模型（约 135 MB，从魔搭下载并核对 SHA-256）。下载失败不让构建失败：没有模型时应用照常运行，只是少一路向量召回
COPY scripts/fetch-embedding-model.mjs ./scripts/
RUN node scripts/fetch-embedding-model.mjs /app/models/multilingual-e5-small     || (echo "embedding model not installed; claim retrieval falls back to lexical search" && rm -rf /app/models && mkdir -p /app/models)

FROM dependencies AS builder
# .dockerignore admits only application source and build configuration.
COPY . .
ENV DEPLOY_OUTPUT=standalone
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=7860
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/models ./models
USER node
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
