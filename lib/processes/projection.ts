import type {
  JsonValue,
  ProcessEdge,
  ProcessNode,
  ProcessProjection,
  ProcessSummary,
  ProjectedColumn,
  ProjectionColumnDefinition,
  ProjectionSelector,
} from "@/lib/processes/contracts";

interface ProjectionInput {
  readonly columns: readonly ProjectionColumnDefinition[];
  readonly edges: readonly ProcessEdge[];
  readonly nodes: readonly ProcessNode[];
  readonly process: ProcessSummary;
}

function latestNode(
  nodes: readonly ProcessNode[],
  kind: string
): ProcessNode | undefined {
  return nodes
    .filter((node) => node.kind === kind)
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id)
    )[0];
}

function processFieldValue(
  process: ProcessSummary,
  field: Extract<ProjectionSelector, { selector: "process_field" }>["field"]
): JsonValue {
  switch (field) {
    case "number":
      return process.number;
    case "status":
      return process.status;
    case "tags":
      return process.tags;
    case "title":
      return process.title;
    case "updatedAt":
      return process.updatedAt;
  }
}

function selectorValue(input: {
  readonly edges: readonly ProcessEdge[];
  readonly nodes: readonly ProcessNode[];
  readonly process: ProcessSummary;
  readonly selector: ProjectionSelector;
}): JsonValue | null {
  const { edges, nodes, process, selector } = input;
  switch (selector.selector) {
    case "process_field":
      return processFieldValue(process, selector.field);
    case "node_metadata": {
      const node = selector.nodeId
        ? nodes.find((candidate) => candidate.id === selector.nodeId)
        : selector.kind
          ? latestNode(nodes, selector.kind)
          : undefined;
      return node?.metadata[selector.key] ?? null;
    }
    case "latest_node_value":
      return latestNode(nodes, selector.kind)?.metadata[selector.key] ?? null;
    case "node_count": {
      const count =
        selector.entity === "node"
          ? nodes.filter(
              (node) => !selector.kind || node.kind === selector.kind
            ).length
          : edges.filter(
              (edge) =>
                !selector.relation || edge.relation === selector.relation
            ).length;
      return Math.min(count, selector.limit);
    }
    default: {
      const exhaustiveSelector: never = selector;
      return exhaustiveSelector;
    }
  }
}

function latestLabels(nodes: readonly ProcessNode[], kind: string): string[] {
  return nodes
    .filter((node) => node.kind === kind)
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id)
    )
    .map((node) => node.label);
}

function latestLabel(
  nodes: readonly ProcessNode[],
  kind: string
): string | null {
  return latestLabels(nodes, kind)[0] ?? null;
}

export function projectProcess({
  columns,
  edges,
  nodes,
  process,
}: ProjectionInput): ProcessProjection {
  const liveNodes = nodes.filter((node) => node.tombstonedAt === null);
  const liveEdges = edges.filter((edge) => edge.tombstonedAt === null);
  const projectedColumns: ProjectedColumn[] = columns
    .map((column) => ({
      emphasis: column.emphasis,
      key: column.key,
      label: column.label,
      position: column.position,
      value: selectorValue({
        edges: liveEdges,
        nodes: liveNodes,
        process,
        selector: column.selector,
      }),
      valueType: column.valueType,
    }))
    .toSorted(
      (left, right) =>
        left.position - right.position || left.key.localeCompare(right.key)
    );

  return {
    blockers: latestLabels(liveNodes, "blocker"),
    columns: projectedColumns,
    generatedAt: process.updatedAt,
    metrics: {
      liveEdges: liveEdges.length,
      liveMetadataFields: liveNodes.reduce(
        (count, node) => count + Object.keys(node.metadata).length,
        0
      ),
      liveNodes: liveNodes.length,
    },
    nextAction: latestLabel(liveNodes, "next_action"),
    pendingItems: latestLabels(liveNodes, "pending"),
    processId: process.id,
    processNumber: process.number,
    projectionVersion: process.projectionSchema.version,
    sourceProcessVersion: process.version,
    status: process.status,
    summary: latestLabel(liveNodes, "summary"),
    tags: process.tags,
    title: process.title,
  };
}
