import { buildServer } from "./server.js";

const port = Number.parseInt(process.env.PORT ?? "3107", 10);
const host = process.env.HOST ?? "127.0.0.1";

const app = await buildServer({
  webhookSecret: process.env.INSCHNEIDERGRAM_WEBHOOK_SECRET
});

await app.listen({ host, port });
console.log(`inschneidergram listening on http://${host}:${port}`);
