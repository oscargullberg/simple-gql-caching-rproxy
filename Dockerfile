FROM node:20.7.0-alpine3.18 as build
WORKDIR /usr/app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:20.7.0 as install
WORKDIR /usr/app
COPY --from=build /usr/app/package*.json ./
COPY --from=build /usr/app/dist ./dist
RUN npm install --production-only

FROM 20.7.0-alpine3.18 as run
WORKDIR /usr/app
COPY --from=build /usr/app/dist ./dist
COPY --from=install /usr/app/node_modules ./node_modules
CMD ["dist/index.js"]
