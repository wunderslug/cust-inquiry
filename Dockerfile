FROM node:22-alpine
WORKDIR /app
COPY server-v2.js ./server.js
COPY build-status-patch.js ./
COPY build-interaction-patch.js ./
COPY build-backup-patch.js ./
COPY public ./public
RUN node build-status-patch.js && node build-interaction-patch.js && node build-backup-patch.js && rm build-status-patch.js build-interaction-patch.js build-backup-patch.js && mkdir -p /app/data
ENV PORT=3080
EXPOSE 3080
CMD ["node", "server.js"]
