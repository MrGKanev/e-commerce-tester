FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@11.3.0

# Install dependencies first for layer caching
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# Copy source (browsers are already installed in the base image)
COPY . .

CMD ["pnpm", "test"]
