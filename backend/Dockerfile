FROM node:20-alpine

WORKDIR /app

# Install dependencies first for layer caching
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src/ ./src/

# Create uploads directory
RUN mkdir -p /app/uploads

EXPOSE 3001

CMD ["node", "src/index.js"]
