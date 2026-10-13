import { createApp } from "./app.js";
import { createDatabaseRouteHandler } from "./composition.js";
import { loadConfig } from "./config/env.js";

const config = loadConfig();
const app = createApp(config, { apiRouteHandler: createDatabaseRouteHandler(config) });

app.listen(config.port, config.host, () => {
  console.info(`commerce-api listening on http://${config.host}:${config.port}`);
});
