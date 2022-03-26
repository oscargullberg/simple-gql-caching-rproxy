FROM node:17.8.0-alpine as build
WORKDIR /usr/app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:17.8.0 as install
WORKDIR /usr/app
COPY --from=build /usr/app/package*.json ./
COPY --from=build /usr/app/dist ./distE
RUN npm install @node-rs/xxhash-linux-x64-musl --save-prod  
RUN npm install --production-only

FROM node:17.8.0-alpine3.15 as run
WORKDIR /usr/app
COPY --from=build /usr/app/dist ./dist
COPY --from=install /usr/app/node_modules ./node_modules
CMD ["dist/index.js"]
