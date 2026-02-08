FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Install Chromium and ALL its system dependencies via Playwright's own installer
RUN npx playwright install --with-deps chromium

COPY . .

# Data volume mount point
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
