FROM node:20-alpine

WORKDIR /app

# Skopiuj manifesty z BACKENDU
COPY backend/package*.json ./

RUN npm install --omit=dev

# Skopiuj kod backendu
COPY backend/ ./

EXPOSE 3000

CMD ["node", "index.js"]
