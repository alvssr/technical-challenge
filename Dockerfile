FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

EXPOSE 3000

CMD ["sh", "-c", "bun run sqs:init && MIKRO_ORM_ALLOW_GLOBAL_CLI=1 bun run migration:up && bun run start:prod"]
