import type { EdgeKind } from "../core/types.js";
import { type GraphEdge, type GraphEdgeMeta, type GraphNode } from "../core/types.js";

export interface GraphJSON {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphStats {
  nodes: number;
  edges: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
}

export interface AddEdgeInput {
  from: string;
  to: string;
  kind: EdgeKind;
  weight?: number;
  meta?: GraphEdgeMeta;
}

/**
 * In-memory code graph (phase 5): typed nodes, typed weighted edges, adjacency
 * in both directions, and a case-insensitive name index. Parallel edges of the
 * same kind between the same endpoints merge by accumulating weight/count, so
 * "A calls B five times" is one edge of weight 5. Serialization is
 * deterministic (sorted) for stable diffs of `.agcontext/graph.json`.
 */
export class CodeGraph {
  private readonly nodeMap = new Map<string, GraphNode>();
  private readonly outgoing = new Map<string, GraphEdge[]>();
  private readonly incoming = new Map<string, GraphEdge[]>();
  private readonly edgeMap = new Map<string, GraphEdge>();
  private readonly nameIndex = new Map<string, string[]>();

  get nodeCount(): number {
    return this.nodeMap.size;
  }

  get edgeCount(): number {
    return this.edgeMap.size;
  }

  addNode(node: GraphNode): GraphNode {
    const existing = this.nodeMap.get(node.id);
    if (existing) return existing;
    this.nodeMap.set(node.id, node);
    const key = node.name.toLowerCase();
    const bucket = this.nameIndex.get(key);
    if (bucket) bucket.push(node.id);
    else this.nameIndex.set(key, [node.id]);
    return node;
  }

  /**
   * Adds (or merges into) an edge. Returns false when either endpoint is
   * missing or the edge would be a self-loop.
   */
  addEdge(input: AddEdgeInput): boolean {
    if (input.from === input.to) return false;
    if (!this.nodeMap.has(input.from) || !this.nodeMap.has(input.to)) return false;
    const id = `${input.from}|${input.kind}|${input.to}`;
    const weight = input.weight ?? 1;
    const existing = this.edgeMap.get(id);
    if (existing) {
      existing.weight += weight;
      const meta = (existing.meta ??= {});
      meta.count = (meta.count ?? 1) + (input.meta?.count ?? 1);
      return true;
    }
    const edge: GraphEdge = {
      id,
      from: input.from,
      to: input.to,
      kind: input.kind,
      weight,
      ...(input.meta ? { meta: { ...input.meta } } : {}),
    };
    this.edgeMap.set(id, edge);
    push(this.outgoing, input.from, edge);
    push(this.incoming, input.to, edge);
    return true;
  }

  node(id: string): GraphNode | undefined {
    return this.nodeMap.get(id);
  }

  hasNode(id: string): boolean {
    return this.nodeMap.has(id);
  }

  fileNode(path: string): GraphNode | undefined {
    return this.nodeMap.get(`file:${path}`);
  }

  allNodes(): IterableIterator<GraphNode> {
    return this.nodeMap.values();
  }

  allEdges(): IterableIterator<GraphEdge> {
    return this.edgeMap.values();
  }

  outEdges(id: string, kinds?: readonly EdgeKind[]): GraphEdge[] {
    return filterKinds(this.outgoing.get(id), kinds);
  }

  inEdges(id: string, kinds?: readonly EdgeKind[]): GraphEdge[] {
    return filterKinds(this.incoming.get(id), kinds);
  }

  degree(id: string): number {
    return (this.outgoing.get(id)?.length ?? 0) + (this.incoming.get(id)?.length ?? 0);
  }

  /** Case-insensitive exact-name lookup. */
  findByName(name: string): GraphNode[] {
    const ids = this.nameIndex.get(name.toLowerCase()) ?? [];
    return ids
      .map((id) => this.nodeMap.get(id))
      .filter((node): node is GraphNode => node !== undefined);
  }

  stats(): GraphStats {
    const nodesByKind: Record<string, number> = {};
    for (const node of this.nodeMap.values()) {
      nodesByKind[node.kind] = (nodesByKind[node.kind] ?? 0) + 1;
    }
    const edgesByKind: Record<string, number> = {};
    for (const edge of this.edgeMap.values()) {
      edgesByKind[edge.kind] = (edgesByKind[edge.kind] ?? 0) + 1;
    }
    return {
      nodes: this.nodeMap.size,
      edges: this.edgeMap.size,
      nodesByKind,
      edgesByKind,
    };
  }

  toJSON(): GraphJSON {
    const nodes = [...this.nodeMap.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    const edges = [...this.edgeMap.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    return { nodes, edges };
  }

  static fromJSON(json: GraphJSON): CodeGraph {
    const graph = new CodeGraph();
    for (const node of json.nodes) graph.addNode(node);
    for (const edge of json.edges) {
      graph.addEdge({
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        weight: edge.weight,
        ...(edge.meta ? { meta: edge.meta } : {}),
      });
    }
    return graph;
  }
}

function push(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(edge);
  else map.set(key, [edge]);
}

function filterKinds(
  edges: GraphEdge[] | undefined,
  kinds: readonly EdgeKind[] | undefined,
): GraphEdge[] {
  if (!edges) return [];
  if (!kinds || kinds.length === 0) return [...edges];
  const set = new Set(kinds);
  return edges.filter((edge) => set.has(edge.kind));
}
