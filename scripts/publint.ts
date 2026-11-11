// publint's CLI never fails on suggestions, and those include metadata that
// npm rewrites when publishing (such as `repository.url`). Fail on any message.
import { publint } from "publint";
import { formatMessage } from "publint/utils";

const { messages, pkg } = await publint({ pack: "pnpm", strict: true });
for (const message of messages) {
  console.error(`${message.type}: ${formatMessage(message, pkg) ?? message.code}`);
}
process.exitCode = messages.length > 0 ? 1 : 0;
