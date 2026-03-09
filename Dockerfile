FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock ./
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
