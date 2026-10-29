FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Caddy, not NGINX (ADR-0002). Runs as non-root on 8080.
FROM caddy:2.11.7-alpine
# Pick up Alpine security fixes released after the base image was built, and strip the
# cap_net_bind_service file capability from caddy: we listen on 8080, and with it the binary
# cannot exec in a pod that drops ALL capabilities ("operation not permitted").
RUN apk upgrade --no-cache \
    && apk add --no-cache --virtual .setcap libcap-setcap \
    && setcap -r /usr/bin/caddy \
    && apk del .setcap
ENV XDG_CONFIG_HOME=/tmp/config XDG_DATA_HOME=/tmp/data
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
USER 65532:65532
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
