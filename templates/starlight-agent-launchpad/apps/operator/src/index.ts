import { loadConfig } from "./config";
import { buildOperator } from "./server";

const config = loadConfig();
const app = await buildOperator({ config });

const stop = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Stopping launchpad operator");
  await app.close();
  process.exit(0);
};

process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "Launchpad operator failed to start");
  process.exit(1);
}
