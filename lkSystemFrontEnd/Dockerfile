FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM nginx:1.27-alpine AS runtime
WORKDIR /usr/share/nginx/html

# Install openssl for self-signed cert generation
RUN apk add --no-cache openssl

# Use nginx template + envsubst so upstream backend host can be configured per environment.
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY docker-entrypoint-ssl.sh /docker-entrypoint-ssl.sh
RUN chmod +x /docker-entrypoint-ssl.sh
COPY --from=builder /app/dist ./

EXPOSE 80 443
ENTRYPOINT ["/docker-entrypoint-ssl.sh"]
CMD ["nginx", "-g", "daemon off;"]
