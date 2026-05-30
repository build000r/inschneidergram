FROM node:22-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3107
ENV INSCHNEIDERGRAM_PROVIDER=mock
ENV INSCHNEIDERGRAM_STORE_PATH=/data/campaigns.json

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
RUN mkdir -p /data

EXPOSE 3107
VOLUME ["/data"]
CMD ["npm", "start"]
