# --- build ---------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY server/prisma server/prisma
RUN npm ci
COPY . .
RUN npm run build

# --- runtime -------------------------------------------------------------
FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV APP_URL=https://www.o-jester.com
ENV API_URL=https://www.o-jester.com
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
WORKDIR /app/server
EXPOSE 4000
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
