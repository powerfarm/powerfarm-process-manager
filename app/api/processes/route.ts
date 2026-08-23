import { processReadHandlers } from "@/lib/processes/http";

export function GET(request: Request) {
  return processReadHandlers.list(request);
}
