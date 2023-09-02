import dotenv from "dotenv";
import fastify from "fastify";
import fastifyCors = require("@fastify/cors");
import fastifyIO from "fastify-socket.io";
import { Redis } from "ioredis";
dotenv.config();

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const CONNECTION_COUNT_CHANNEL = "chat:connection-count";
if (!UPSTASH_REDIS_REST_URL) {
  throw new Error("UPSTASH_REDIS_REST_URL is required");
}

const publisher = new Redis(UPSTASH_REDIS_REST_URL);
const subcriber = new Redis(UPSTASH_REDIS_REST_URL);

async function buildServer() {
  const app = fastify();

  await app.register(fastifyCors, {
    origin: CORS_ORIGIN,
  });

  await app.register(fastifyIO)

  const currentCount = await publisher.get(CONNECTION_COUNT_CHANNEL);

  if (!currentCount) {
    await publisher.set(CONNECTION_COUNT_CHANNEL, 0);
  }

  app.io.on("connection", async (io) => {
    console.log("socket.io connected");
    await publisher.incr(CONNECTION_COUNT_CHANNEL);
    io.on("disconnect", () => {
      console.log("disconnected");
    });
  })

  app.get("/healthcheck", () => {
    return { status: "ok", port: PORT };
  });
  return app;
}

async function main() {
  const app = await buildServer();

  try {
    await app.listen({
      port: PORT,
      host: HOST,
    });
    console.log(`Server is listening on ${HOST}:${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
