FROM node:24-alpine
# Pick up Alpine security fixes released after the base image was built (Trivy CRITICAL otherwise).
RUN apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Node 24 runs the TypeScript sources directly (type stripping): no build step.
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
