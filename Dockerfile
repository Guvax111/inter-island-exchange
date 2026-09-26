# syntax=docker/dockerfile:1.7
# One Dockerfile, two images:
#   docker build --target api -t iie-api .     (API, worker and database migrations)
#   docker build --target web -t iie-web --build-arg API_ORIGIN=http://api:4000 .
# Behind a TLS-inspecting proxy, pass its CA certificate: --secret id=extra_ca,src=/path/to/ca.crt (optional).
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# ---- install and build everything once
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca \
    sh -c 'if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; pnpm install --frozen-lockfile'
COPY . .
# Next.js fixes the /api/v1 proxy target at build time, so the API's address inside the stack is a build argument.
ARG API_ORIGIN=http://api:4000
ARG NEXT_PUBLIC_ENVIRONMENT_LABEL=
ENV API_ORIGIN=$API_ORIGIN NEXT_PUBLIC_ENVIRONMENT_LABEL=$NEXT_PUBLIC_ENVIRONMENT_LABEL NEXT_OUTPUT=standalone
RUN --mount=type=secret,id=extra_ca \
    sh -c 'if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; pnpm --filter @iie/shared build && pnpm --filter @iie/api build && pnpm --filter @iie/web build'

# ---- API production dependencies only
FROM base AS api-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca \
    sh -c 'if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; pnpm install --frozen-lockfile --prod --filter @iie/api...'

# ---- API / worker / migrations image
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production TZ=America/St_Vincent
WORKDIR /app
COPY --from=api-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=api-deps --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-deps --chown=node:node /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build --chown=node:node /repo/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=node:node /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./apps/api/drizzle
RUN mkdir -p /data/media && chown node:node /data/media
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- website image (Next.js standalone server)
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production TZ=America/St_Vincent PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
