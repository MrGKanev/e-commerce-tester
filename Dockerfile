FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

# Optional local OCR; image/model installation is explicitly enabled at build time.
ARG INSTALL_OCR=0
RUN if [ "$INSTALL_OCR" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-bul && \
      rm -rf /var/lib/apt/lists/*; \
    fi

# Install pnpm
RUN npm install -g pnpm@11.3.0

# Install dependencies first for layer caching
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# Copy source (browsers are already installed in the base image)
COPY . .

CMD ["pnpm", "test"]
