FROM maven:3.9-eclipse-temurin-21
RUN apt-get update && apt-get install -y nodejs npm unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY . .
CMD ["node", "server.js"]
