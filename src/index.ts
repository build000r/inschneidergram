import { buildServer } from "./server.js";
import { JsonFileCampaignStore } from "./domain/store.js";
import { readRuntimeConfig } from "./runtimeConfig.js";

const config = readRuntimeConfig();

const app = await buildServer({
  store: new JsonFileCampaignStore(config.storePath),
  webhookSecret: config.webhookSecret,
  provider: config.provider,
  apiKey: config.apiKey
});

await app.listen({ host: config.host, port: config.port });
console.log(`inschneidergram listening on http://${config.host}:${config.port}`);
