import { useEffect, useRef, useCallback, useState } from "react";
import * as d3 from "d3";
import { getGraph, resetGraph } from "../api";
import type { GraphNode, GraphEdge, GraphResponse } from "../api";
import "./KnowledgeGraph.css";

interface Props {
  version: number;
  onNodeClick: (conceptName: string) => void;
}

// Color palette by entity type
const TYPE_COLORS: Record<string, string> = {
  person: "#86efac",
  organization: "#c4b5fd",
  concept: "#93c5fd",
  term: "#f9a8d4",
  event: "#fcd34d",
  location: "#67e8f9",
  product: "#a3e635",
  other: "#94a3b8",
};

function typeColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? TYPE_COLORS.other;
}

export default function KnowledgeGraph({ version, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; node: GraphNode;
  } | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

  // Fetch graph whenever a new document is uploaded
  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getGraph();
      setGraph(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
  }, [version, fetchGraph]);

  // Build / update D3 simulation
  useEffect(() => {
    if (!graph || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    if (graph.nodes.length === 0) return;

    const { width, height } = svgRef.current.getBoundingClientRect();
    const W = width || 380;
    const H = height || 500;

    // Deep-clone so D3 can mutate positions
    const nodes: GraphNode[] = graph.nodes.map((n) => ({ ...n }));
    const links: GraphEdge[] = graph.links.map((l) => ({ ...l }));

    // ── Zoom container ──────────────────────────────────────────────────────
    const g = svg.append("g");

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on("zoom", (event) => g.attr("transform", event.transform))
    );

    // ── Defs: arrow marker ──────────────────────────────────────────────────
    svg.append("defs").append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 18)
      .attr("refY", 0)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4")
      .attr("fill", "#4a5568");

    // ── Links ───────────────────────────────────────────────────────────────
    const maxWeight = Math.max(...links.map((l) => l.weight), 1);

    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#2d3550")
      .attr("stroke-opacity", 0.8)
      .attr("stroke-width", (d) => 1 + (d.weight / maxWeight) * 3)
      .attr("marker-end", "url(#arrow)");

    // Edge labels
    const edgeLabel = g.append("g")
      .selectAll("text")
      .data(links)
      .join("text")
      .attr("fill", "#4a5568")
      .attr("font-size", "9px")
      .attr("text-anchor", "middle")
      .text((d) => d.label);

    // ── Nodes ───────────────────────────────────────────────────────────────
    const nodeGroup = g.append("g")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => {
            if (!event.active) simulationRef.current?.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      );

    nodeGroup.append("circle")
      .attr("r", (d) => 8 + Math.min(d.document_sources.length * 2, 8))
      .attr("fill", (d) => typeColor(d.type))
      .attr("fill-opacity", 0.85)
      .attr("stroke", (d) => typeColor(d.type))
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.5);

    nodeGroup.append("text")
      .attr("dy", "0.35em")
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("font-weight", "500")
      .attr("fill", "#e2e8f0")
      .attr("pointer-events", "none")
      .text((d) => d.label.length > 14 ? d.label.slice(0, 13) + "…" : d.label);

    // Node interactions
    nodeGroup
      .on("mouseenter", (event, d) => {
        const rect = svgRef.current!.getBoundingClientRect();
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          node: d,
        });
      })
      .on("mouseleave", () => setTooltip(null))
      .on("click", (_event, d) => {
        onNodeClick(d.label);
      });

    // ── Force simulation ────────────────────────────────────────────────────
    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphEdge>(links)
        .id((d) => d.id)
        .distance(90)
        .strength(0.4))
      .force("charge", d3.forceManyBody().strength(-220))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide().radius(30))
      .on("tick", () => {
        link
          .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
          .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
          .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
          .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

        edgeLabel
          .attr("x", (d) => (((d.source as GraphNode).x ?? 0) + ((d.target as GraphNode).x ?? 0)) / 2)
          .attr("y", (d) => (((d.source as GraphNode).y ?? 0) + ((d.target as GraphNode).y ?? 0)) / 2);

        nodeGroup.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

    simulationRef.current = sim;

    return () => { sim.stop(); };
  }, [graph, onNodeClick]);

  const handleReset = async () => {
    await resetGraph();
    await fetchGraph();
  };

  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.links.length ?? 0;

  return (
    <div className="knowledge-graph">
      {/* Header */}
      <div className="kg-header">
        <div>
          <h3 className="kg-title">Knowledge Graph</h3>
          <p className="kg-subtitle">
            {nodeCount} concepts · {edgeCount} relations
          </p>
        </div>
        <div className="kg-actions">
          <button className="btn btn-ghost kg-btn" onClick={fetchGraph} title="Refresh">↺</button>
          <button className="btn btn-danger kg-btn" onClick={handleReset} title="Clear graph">✕</button>
        </div>
      </div>

      {/* Legend */}
      <div className="kg-legend">
        {Object.entries(TYPE_COLORS).slice(0, 6).map(([type, color]) => (
          <span key={type} className="legend-item">
            <span className="legend-dot" style={{ background: color }} />
            {type}
          </span>
        ))}
      </div>

      {/* SVG canvas */}
      <div className="kg-canvas">
        {loading && (
          <div className="kg-loading">
            <span className="spin">⚙️</span> Building graph…
          </div>
        )}
        {!loading && nodeCount === 0 && (
          <div className="kg-empty">
            <p>📊</p>
            <p>Upload a document to generate<br />the knowledge graph</p>
          </div>
        )}
        <svg ref={svgRef} className="kg-svg" />

        {/* Tooltip */}
        {tooltip && (
          <div
            className="kg-tooltip"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
          >
            <div className="tt-header">
              <span
                className="tt-dot"
                style={{ background: typeColor(tooltip.node.type) }}
              />
              <strong>{tooltip.node.label}</strong>
              <span className="tt-type">{tooltip.node.type}</span>
            </div>
            {tooltip.node.description && (
              <p className="tt-desc">{tooltip.node.description}</p>
            )}
            {tooltip.node.document_sources.length > 0 && (
              <p className="tt-sources">
                📄 {tooltip.node.document_sources.join(", ")}
              </p>
            )}
            <p className="tt-hint">Click to ask about this concept</p>
          </div>
        )}
      </div>
    </div>
  );
}
