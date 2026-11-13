FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/data/patients.db PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "src/server.js"]
