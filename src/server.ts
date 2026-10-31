import { agent, numberLanguages } from "./agents/load";
import { createServer } from "./app";
import { env, listenPort, skipSignature } from "./config";
import { logger } from "./events/bus";
import { fastModel, model } from "./models/registry";
import { publicNumbers } from "./routes/status";
import { drain, liveCallCount, maxConcurrentCalls } from "./session/capacity";
import { getVoiceSettings } from "./voices/settings";

const port = listenPort();
// The agent and the models load before the server listens, so a
// broken agent file or an unknown model provider fails while
// deploying, rather than on the first call to the number.
const loaded = agent();
const { id: modelId } = model();
fastModel();
getVoiceSettings();
numberLanguages();
publicNumbers();
maxConcurrentCalls();

// Without signature checks anyone can post to /voice and open /ws
// as if they were Twilio and spend model tokens, so production
// refuses the flag, and development warns about it on boot.
if (skipSignature()) {
  if (env.NODE_ENV === "production") {
    throw new Error("SKIP_TWILIO_SIGNATURE=true is not allowed when NODE_ENV=production");
  }
  logger.warn(
    "SKIP_TWILIO_SIGNATURE=true: Twilio signatures are not checked. Never expose this server publicly.",
  );
}

const server = createServer();

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
server.listen(port, "0.0.0.0", () => {
  logger.info(
    {
      port,
      agent: loaded.name,
      model: loaded.responder === "echo" ? "echo" : modelId,
      maxCalls: maxConcurrentCalls(),
    },
    "Server listening",
  );
});

// A stop signal turns new calls away and lets live ones finish,
// up to the time limit, so a redeploy never cuts off callers
// mid-sentence. A second signal makes it exit right away.
let stopping = false;
function shutdown(signal: NodeJS.Signals) {
  if (stopping) {
    logger.warn({ signal, liveCalls: liveCallCount() }, "Second stop signal, exiting now");
    process.exit(1);
  }
  stopping = true;
  const graceMs = (loaded.time_limit_seconds + 10) * 1000;
  logger.info(
    { signal, liveCalls: liveCallCount(), graceMs },
    "Stopping: refusing new calls, waiting for live calls",
  );
  const deadline = setTimeout(() => {
    logger.warn({ liveCalls: liveCallCount() }, "Grace period over, exiting with calls still live");
    process.exit(0);
  }, graceMs);
  deadline.unref();
  void drain().then(() => {
    logger.info("No live calls, exiting");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
