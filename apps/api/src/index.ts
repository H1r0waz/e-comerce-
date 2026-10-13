import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, config.host, () => {
  console.info(`commerce-api listening on http://${config.host}:${config.port}`);
});
