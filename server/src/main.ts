import dotenv from "dotenv";
import fastify from "fastify";
import fastifyCors = require("@fastify/cors");
import fastifyIO from "fastify-socket.io";
import { Redis } from "ioredis";
import closeWithGrace from "close-with-grace";
dotenv.config();

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const CONNECTION_COUNT_KEY = "chat:connection-count";
const CONNECTION_COUNT_UPDATED_CHANNEL = "chat:connection-count-updated";
const NEW_MESSAGE_CHANNEL = "chat:new-message";
const MESSAGES_KEY = "chat:messages";





if (!UPSTASH_REDIS_REST_URL) {
  throw new Error("UPSTASH_REDIS_REST_URL is required");
} else {
  console.log("UPSTASH_REDIS_REST_URL is found");
}

const publisher = new Redis(UPSTASH_REDIS_REST_URL, {
  tls: {
    rejectUnauthorized: false,
  },
});
const subscriber = new Redis(UPSTASH_REDIS_REST_URL, {
  tls: {
    rejectUnauthorized: false,
  },
});

publisher.on("error", (error) => {
  console.error("Redis Connection Error: at 25", error);
});
subscriber.on("error", (error) => {
  console.error("Redis Connection Error: at 28", error);
});

let connectedClients = 0;

async function buildServer() {
  const app = fastify();

  await app.register(fastifyCors, {
    origin: CORS_ORIGIN,
  });

  await app.register(fastifyIO);

  const currentCount = await publisher.get(CONNECTION_COUNT_KEY);

  if (!currentCount) {
    await publisher.set(CONNECTION_COUNT_KEY, 0);
  }

  app.io.on("connection", async (io) => {
    console.log("connected", io.id);
    connectedClients++;
    const incResult = await publisher.incr(CONNECTION_COUNT_KEY);
    console.log("incResult", incResult);
    await publisher.publish(
      CONNECTION_COUNT_UPDATED_CHANNEL,
      String(incResult)
    );

    io.on(NEW_MESSAGE_CHANNEL, async({
        message
    })=>{
        await publisher.publish(NEW_MESSAGE_CHANNEL,message.toString())
    })

    io.on("disconnect", async () => {
      console.log("disconnected", io.id);
      connectedClients--;
      const decrResult = await publisher.decr(CONNECTION_COUNT_KEY);
      console.log("decrResult", decrResult);
      await publisher.publish(
        CONNECTION_COUNT_UPDATED_CHANNEL,
        String(decrResult)
      );
    });
  });

  subscriber.subscribe(CONNECTION_COUNT_UPDATED_CHANNEL, (err, count) => {
    if (err) {
      console.error(
        "error subscribing channel",
        CONNECTION_COUNT_UPDATED_CHANNEL,
        "error",
        err
      );
      return;
    }

    console.log(
      "subscribed to channel",
      CONNECTION_COUNT_UPDATED_CHANNEL,
      "count",
      count
    );
  });


  subscriber.subscribe(NEW_MESSAGE_CHANNEL, (err, count) => {

    if (err) {
      console.error(
        "error subscribing channel",
        NEW_MESSAGE_CHANNEL,
        "error",
        err
      );
      return;
    }

    console.log(`subscribed to channel ${NEW_MESSAGE_CHANNEL} count ${count}`)

  })

  subscriber.on("message", (channel, text) => {
    if (channel === CONNECTION_COUNT_UPDATED_CHANNEL) {
      console.log(
        "received message from channel",
        CONNECTION_COUNT_UPDATED_CHANNEL,
        "text",
        text
      );
      app.io.emit(CONNECTION_COUNT_UPDATED_CHANNEL, { count: text });
      return;
    }


    if (channel === NEW_MESSAGE_CHANNEL) {
        console.log(
          "received message from channel",
          NEW_MESSAGE_CHANNEL,
          "text",
          text
        );
        app.io.emit(NEW_MESSAGE_CHANNEL, { message: text });
        return;
    }
  });

  app.get("/healthcheck", async () => {
    await publisher.decr(CONNECTION_COUNT_KEY);
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

    closeWithGrace({ delay: 2000 }, async () => {
      console.log(`Signal  received. Closing gracefully`);
      await app.close();
      console.log(`Signal  received. Closed gracefully`);

      if (connectedClients > 0) {
        await publisher.set(CONNECTION_COUNT_KEY, 0);

        const currentCount = parseInt(
          (await publisher.get(CONNECTION_COUNT_KEY)) || "0",
          10
        );
        const newCount = Math.max(currentCount - connectedClients,0 );
        await publisher.set(CONNECTION_COUNT_KEY, newCount);
      }
    });
    console.log(`Server is listening on ${HOST}:${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
