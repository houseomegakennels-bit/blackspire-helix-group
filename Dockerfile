FROM node:24-slim
RUN apt-get update && apt-get install -y sqlite3 git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tests ./tests
RUN npm run build
EXPOSE 8787
CMD ["npm","run","dev"]
