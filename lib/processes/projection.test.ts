import { describe, expect, it } from "vitest";
import type {
  ProcessEdge,
  ProcessNode,
  ProcessSummary,
  ProjectionColumnDefinition,
} from "@/lib/processes/contracts";
import { projectProcess } from "@/lib/processes/projection";

const process: ProcessSummary = {
  archivedAt: null,
  createdAt: "2026-08-23T07:00:00.000Z",
  graphSchemaVersion: 1,
  id: "process-1",
  number: 123,
  ownerId: "owner-1",
  projectionSchema: { columns: [], version: 1 },
  status: "in_progress",
  tags: ["launch"],
  title: "Launch test",
  updatedAt: "2026-08-23T08:00:00.000Z",
  version: 7,
};

const nodes: readonly ProcessNode[] = [
  {
    createdAt: "2026-08-23T07:10:00.000Z",
    id: "brief-1",
    kind: "brief",
    label: "Initial brief",
    metadata: { audience: "Operators", priority: 2 },
    processId: "process-1",
    tombstonedAt: null,
    updatedAt: "2026-08-23T07:10:00.000Z",
  },
  {
    createdAt: "2026-08-23T07:20:00.000Z",
    id: "brief-2",
    kind: "brief",
    label: "Revised brief",
    metadata: { audience: "Founders", priority: 1 },
    processId: "process-1",
    tombstonedAt: null,
    updatedAt: "2026-08-23T07:30:00.000Z",
  },
  {
    createdAt: "2026-08-23T07:40:00.000Z",
    id: "blocker-1",
    kind: "blocker",
    label: "Legal review",
    metadata: { owner: "Legal" },
    processId: "process-1",
    tombstonedAt: null,
    updatedAt: "2026-08-23T07:40:00.000Z",
  },
];

const edges: readonly ProcessEdge[] = [
  {
    createdAt: "2026-08-23T07:25:00.000Z",
    id: "edge-1",
    metadata: {},
    processId: "process-1",
    relation: "revises",
    sourceNodeId: "brief-2",
    targetNodeId: "brief-1",
    tombstonedAt: null,
    updatedAt: "2026-08-23T07:25:00.000Z",
  },
  {
    createdAt: "2026-08-23T07:45:00.000Z",
    id: "edge-2",
    metadata: {},
    processId: "process-1",
    relation: "blocks",
    sourceNodeId: "blocker-1",
    targetNodeId: "brief-2",
    tombstonedAt: null,
    updatedAt: "2026-08-23T07:45:00.000Z",
  },
];

const columns: readonly ProjectionColumnDefinition[] = [
  {
    emphasis: "strong",
    key: "status",
    label: "State",
    position: 0,
    selector: { field: "status", selector: "process_field" },
    valueType: "status",
  },
  {
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
  {
    emphasis: "normal",
    key: "blocker-owner",
    label: "Blocker owner",
    position: 2,
    selector: {
      key: "owner",
      nodeId: "blocker-1",
      selector: "node_metadata",
    },
    valueType: "text",
  },
  {
    emphasis: "muted",
    key: "brief-count",
    label: "Briefs",
    position: 3,
    selector: {
      entity: "node",
      kind: "brief",
      limit: 1,
      selector: "node_count",
    },
    valueType: "number",
  },
];

describe("projectProcess", () => {
  it("keeps fixed process fields ahead of dynamic columns", () => {
    const projection = projectProcess({ columns, edges, nodes, process });

    expect(projection.processNumber).toBe(123);
    expect(projection.title).toBe("Launch test");
    expect(projection.status).toBe("in_progress");
    expect(projection.tags).toEqual(["launch"]);
    expect(projection.columns.map((column) => column.key)).toEqual([
      "status",
      "audience",
      "blocker-owner",
      "brief-count",
    ]);
  });

  it("resolves process, node metadata, latest value, and count selectors", () => {
    const projection = projectProcess({ columns, edges, nodes, process });

    expect(projection.columns).toEqual([
      expect.objectContaining({ key: "status", value: "in_progress" }),
      expect.objectContaining({ key: "audience", value: "Founders" }),
      expect.objectContaining({ key: "blocker-owner", value: "Legal" }),
      expect.objectContaining({ key: "brief-count", value: 1 }),
    ]);
    expect(projection.metrics).toEqual({
      liveEdges: 2,
      liveMetadataFields: 5,
      liveNodes: 3,
    });
  });

  it("returns null when a selector source is missing", () => {
    const missingColumn: ProjectionColumnDefinition = {
      emphasis: "normal",
      key: "missing",
      label: "Missing",
      position: 1,
      selector: {
        key: "unknown",
        nodeId: "brief-1",
        selector: "node_metadata",
      },
      valueType: "text",
    };

    const projection = projectProcess({
      columns: [missingColumn],
      edges,
      nodes,
      process,
    });

    expect(projection.columns[0]?.value).toBeNull();
  });

  it("sorts equal-position columns by stable key", () => {
    const projection = projectProcess({ columns, edges, nodes, process });

    expect(projection.columns.slice(1, 3).map((column) => column.key)).toEqual([
      "audience",
      "blocker-owner",
    ]);
  });

  it("caps count selectors at their declared limit", () => {
    const projection = projectProcess({ columns, edges, nodes, process });

    expect(
      projection.columns.find((column) => column.key === "brief-count")?.value
    ).toBe(1);
  });

  it("excludes tombstoned graph rows from values and metrics", () => {
    const projection = projectProcess({
      columns,
      edges: [
        { ...edges[0], tombstonedAt: "2026-08-23T08:00:00.000Z" },
        edges[1],
      ],
      nodes: [
        { ...nodes[0], tombstonedAt: "2026-08-23T08:00:00.000Z" },
        nodes[1],
        nodes[2],
      ],
      process,
    });

    expect(projection.metrics).toEqual({
      liveEdges: 1,
      liveMetadataFields: 3,
      liveNodes: 2,
    });
  });
});
