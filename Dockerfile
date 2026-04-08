FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY src/shared/package.json src/shared/
COPY src/backend-shared/package.json src/backend-shared/
COPY src/backend-types/package.json src/backend-types/
COPY src/backend-desktop/package.json src/backend-desktop/
COPY src/backend-web/package.json src/backend-web/
COPY src/frontend-shared/package.json src/frontend-shared/
COPY src/frontend-desktop/package.json src/frontend-desktop/
COPY src/frontend-web/package.json src/frontend-web/
COPY src/frontend-demo/package.json src/frontend-demo/
COPY src/cli/package.json src/cli/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build:server

FROM oven/bun:1

WORKDIR /app
COPY --from=build /app/dist-server ./

ENV DOTAZ_HOST=0.0.0.0
ENV DOTAZ_PORT=6401

EXPOSE 6401

CMD ["bun", "run", "bin/dotaz.js"]
