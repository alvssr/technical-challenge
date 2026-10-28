FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

EXPOSE 3000

CMD ["sh", "-c", "bun run sqs:init && bun run migration:up && bun run start:prod"]
