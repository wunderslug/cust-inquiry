FROM node:22-alpine
WORKDIR /app
COPY server-v2.js ./server.js
COPY public ./public
RUN mkdir -p /app/data
ENV PORT=3080
EXPOSE 3080
CMD ["node", "server.js"]
