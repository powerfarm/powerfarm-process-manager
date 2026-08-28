import { mcpChannel } from "eve/channels/mcp";
import { mcpUserAuth } from "@/lib/mcp-auth";

export default mcpChannel({
  auth: mcpUserAuth,
});
