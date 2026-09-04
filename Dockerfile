FROM node:22-alpine
WORKDIR /app
COPY server-v2.js ./server.js
COPY build-status-patch.js ./
RUN node build-status-patch.js && rm build-status-patch.js && mkdir -p /app/data
COPY public ./public
ENV PORT=3080
EXPOSE 3080
CMD ["node", "server.js"]
