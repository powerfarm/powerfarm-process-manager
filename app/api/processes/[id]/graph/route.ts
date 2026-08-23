import { processReadHandlers } from "@/lib/processes/http";

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> }
) {
  const { id } = await params;
  return processReadHandlers.graph(request, id);
}
