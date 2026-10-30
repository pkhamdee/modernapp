FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Node 24 runs the TypeScript sources directly (type stripping), so there is no build step.
FROM node:24-alpine
# smbclient talks to the share (SMB3, NTLMv2). apk upgrade picks up Alpine fixes released after the base image.
# npm/corepack are not needed at runtime: removing them keeps their bundled dependencies out of Trivy's findings.
RUN apk upgrade --no-cache \
    && apk add --no-cache samba-client \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DEMO_IMAGES_DIR=/app/demo-images
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY demo-images ./demo-images
USER 1000:1000
EXPOSE 8080
CMD ["node", "src/server.ts"]
