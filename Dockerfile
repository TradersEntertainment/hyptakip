FROM node:24-slim

# Install necessary build tools for native SQLite modules if needed
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Create persistent data volume directory for Railway
RUN mkdir -p /data

# Railway Persistent Volume Environment variable
ENV DATA_DIR=/data
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
