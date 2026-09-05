FROM node:24.15.0-alpine3.23 AS build
WORKDIR /usr/app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

RUN npm prune --omit=dev

FROM node:24.15.0-alpine3.23 AS run
WORKDIR /usr/app
ENV NODE_ENV=production
COPY --from=build /usr/app/dist ./dist
COPY --from=build /usr/app/node_modules ./node_modules
COPY package*.json ./
USER node
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
