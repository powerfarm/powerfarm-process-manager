import { describe, expect, it } from "vitest";
import {
  graphOperationSchema,
  MAX_GRAPH_METADATA_BYTES,
} from "@/lib/processes/contracts";
import {
  decodeEventCursor,
  decodeGraphCursor,
  encodeEventCursor,
  encodeGraphCursor,
} from "@/lib/processes/cursor";
import { formatProcessNumber } from "@/lib/processes/format";

describe("graphOperationSchema", () => {
  it.each([
    {
      input: {
        kind: "brief",
        label: "Launch brief",
        metadata: { audience: "Operators" },
        nodeId: "node-1",
        op: "add_node",
      },
      op: "add_node",
    },
    {
      input: {
        label: "Approved launch brief",
        metadata: { approved: true },
        nodeId: "node-1",
        op: "update_node",
      },
      op: "update_node",
    },
    {
      input: { nodeId: "node-1", op: "tombstone_node" },
      op: "tombstone_node",
    },
    {
      input: {
        edgeId: "edge-1",
        metadata: { confidence: 0.9 },
        op: "link_nodes",
        relation: "supports",
        sourceNodeId: "node-1",
        targetNodeId: "node-2",
      },
      op: "link_nodes",
    },
    {
      input: { edgeId: "edge-1", op: "unlink_nodes" },
      op: "unlink_nodes",
    },
    {
      input: {
        column: {
          emphasis: "normal",
          key: "audience",
          label: "Audience",
          position: 2,
          selector: {
            key: "audience",
            kind: "brief",
            selector: "latest_node_value",
          },
          valueType: "text",
        },
        op: "define_projection_column",
      },
      op: "define_projection_column",
    },
  ])("accepts the $op operation", ({ input, op }) => {
    expect(graphOperationSchema.parse(input).op).toBe(op);
  });

  it("rejects an operation outside the fixed grammar", () => {
    expect(() =>
      graphOperationSchema.parse({
        op: "replace_json_path",
        path: "/ownerId",
        value: "someone-else",
      })
    ).toThrow();
  });

  it("rejects metadata above the serialized byte limit", () => {
    expect(() =>
      graphOperationSchema.parse({
        kind: "brief",
        label: "Oversized",
        metadata: { body: "x".repeat(MAX_GRAPH_METADATA_BYTES) },
        nodeId: "node-large",
        op: "add_node",
      })
    ).toThrow();
  });
});

describe("formatProcessNumber", () => {
  it("renders a human process number with a stable prefix and padding", () => {
    expect(formatProcessNumber(123)).toBe("PROC-000123");
  });

  it("rejects zero and non-integer process numbers", () => {
    expect(() => formatProcessNumber(0)).toThrow();
    expect(() => formatProcessNumber(1.5)).toThrow();
  });
});

describe("process cursors", () => {
  it("round-trips a graph keyset without adding authority fields", () => {
    const encoded = encodeGraphCursor({
      id: "node-9",
      updatedAt: "2026-08-23T08:00:00.000Z",
    });

    expect(decodeGraphCursor(encoded)).toEqual({
      id: "node-9",
      updatedAt: "2026-08-23T08:00:00.000Z",
    });
    expect(encoded).not.toContain("owner");
  });

  it("round-trips an event keyset", () => {
    const encoded = encodeEventCursor({ eventId: "event-5", sequence: 5 });

    expect(decodeEventCursor(encoded)).toEqual({
      eventId: "event-5",
      sequence: 5,
    });
  });

  it("rejects a malformed graph cursor", () => {
    expect(() => decodeGraphCursor("not-a-cursor")).toThrow();
  });

  it("rejects an event cursor with extra authority data", () => {
    const encoded = Buffer.from(
      JSON.stringify({ eventId: "event-5", ownerId: "owner-2", sequence: 5 }),
      "utf8"
    ).toString("base64url");

    expect(() => decodeEventCursor(encoded)).toThrow();
  });
});
