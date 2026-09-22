# Place this in the ROOT of your backend repo as "Dockerfile"
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# argon2 has no prebuilt binary for Alpine/musl, so it compiles from source
# during npm ci — needs python3/make/g++. Removed after install to keep the
# final image small.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev \
  && apk del .build-deps
COPY . .
EXPOSE 4000
# Adjust this to wherever your server's entry point actually is
CMD ["node", "src/index.js"]
