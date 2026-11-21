FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY shared/package.json shared/
RUN npm ci
COPY tsconfig.base.json ./
COPY backend/ backend/
COPY frontend/ frontend/
COPY shared/ shared/
COPY database/ database/
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules/
COPY --from=build /app/backend/package.json backend/
COPY --from=build /app/backend/dist backend/dist/
COPY --from=build /app/frontend/dist frontend/dist/
COPY --from=build /app/database/migrations database/migrations/
USER node
CMD ["node", "backend/dist/backend/src/server.js"]
