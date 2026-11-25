FROM node:20-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY shared/category_map.json shared/thresholds.json /app/shared/
EXPOSE 5000
CMD ["node", "src/server.js"]
