"use client";

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  FileText,
  ExternalLink,
  ChevronRight,
  Network,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GraphNode, GraphEdge, GraphCitation } from "@/lib/api";

export interface InteractiveGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  citations: Record<string, GraphCitation>;
  onOpenDocument?: (docId: string, page?: number) => void;
  selectedPredicate?: string;
  className?: string;
}

interface SimNode {
  id: string;
  name: string;
  entityType: string;
  aliases: string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  degree: number;
  color: string;
  isPinned?: boolean;
}

interface SimEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  confidence: number;
  extractor: string;
  citation?: GraphCitation;
}

const ENTITY_CONFIG: Record<string, { color: string; label: string; ring: string }> = {
  customer: { color: "#9DB38A", label: "Customer", ring: "rgba(157,179,138, 0.35)" },
  risk: { color: "#EF6B57", label: "Risk", ring: "rgba(239,107,87, 0.35)" },
  competitor: { color: "#D9A441", label: "Competitor", ring: "rgba(217,164,65, 0.35)" },
  product: { color: "#A7798A", label: "Product", ring: "rgba(167,121,138, 0.35)" },
  action: { color: "#C9A46A", label: "Action", ring: "rgba(201,164,106, 0.35)" },
  metric: { color: "#7F95A6", label: "Metric", ring: "rgba(127,149,166, 0.35)" },
  person: { color: "#C07A66", label: "Person", ring: "rgba(192,122,102, 0.35)" },
  report: { color: "#B58A9B", label: "Report", ring: "rgba(167,121,138, 0.35)" },
  subject: { color: "#A99A86", label: "Subject", ring: "rgba(169,154,134, 0.35)" },
};

function getEntityStyle(type?: string) {
  const key = (type || "").toLowerCase().trim();
  return (
    ENTITY_CONFIG[key] || {
      color: "#A99A86",
      label: type || "Entity",
      ring: "rgba(169,154,134, 0.3)",
    }
  );
}

function truncateText(str: string, maxLen = 14): string {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}

export function InteractiveKnowledgeGraph({
  nodes,
  edges,
  citations,
  onOpenDocument,
  selectedPredicate,
  className,
}: InteractiveGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Pan & Zoom transform state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Simulation refs
  const simNodesRef = useRef<Map<string, SimNode>>(new Map());
  const draggingNodeRef = useRef<SimNode | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef<number | null>(null);
  const pulseOffsetRef = useRef(0);
  const simulationWarmthRef = useRef(1.0);

  // Initialize simulation edges
  const simEdges: SimEdge[] = useMemo(() => {
    return edges.map((e) => ({
      id: e.edge_id,
      source: e.subject_node_id,
      target: e.object_node_id,
      predicate: e.predicate,
      confidence: e.confidence,
      extractor: e.extractor,
      citation: citations[e.edge_id],
    }));
  }, [edges, citations]);

  // Node degree calculation for visual hierarchy
  const degrees = useMemo(() => {
    const degMap: Record<string, number> = {};
    for (const e of edges) {
      degMap[e.subject_node_id] = (degMap[e.subject_node_id] || 0) + 1;
      degMap[e.object_node_id] = (degMap[e.object_node_id] || 0) + 1;
    }
    return degMap;
  }, [edges]);

  // Synchronize incoming nodes into simulation map with spacious initial layout
  useEffect(() => {
    const map = simNodesRef.current;
    const width = containerRef.current?.clientWidth || 900;
    const height = containerRef.current?.clientHeight || 640;

    const nextMap = new Map<string, SimNode>();
    const n = nodes.length;

    nodes.forEach((node, i) => {
      const existing = map.get(node.node_id);
      const degree = degrees[node.node_id] || 0;
      const isHub = degree >= 3 || node.entity_type?.toLowerCase() === "customer" || node.entity_type?.toLowerCase() === "competitor";

      // Spacious radial distribution
      const angle = (i / Math.max(n, 1)) * Math.PI * 2;
      const radiusDist = isHub ? 160 + (i % 2) * 50 : 260 + (i % 4) * 80;
      const initialX = width / 2 + Math.cos(angle) * radiusDist;
      const initialY = height / 2 + Math.sin(angle) * radiusDist;

      const entityType = node.entity_type || "Entity";
      const style = getEntityStyle(entityType);
      const radius = isHub ? 26 : 18;

      nextMap.set(node.node_id, {
        id: node.node_id,
        name: node.canonical_name || node.node_id,
        entityType,
        aliases: node.aliases || [],
        x: existing ? existing.x : initialX,
        y: existing ? existing.y : initialY,
        vx: 0,
        vy: 0,
        radius,
        degree,
        color: style.color,
        isPinned: existing?.isPinned ?? false,
      });
    });

    simNodesRef.current = nextMap;
    simulationWarmthRef.current = 1.0; // Trigger gentle reorganization
  }, [nodes, degrees]);

  // Physics simulation with spacious repulsion & anti-collision
  const updatePhysics = useCallback(() => {
    const nodeMap = simNodesRef.current;
    const nodeList = Array.from(nodeMap.values());
    if (nodeList.length === 0) return;

    const width = containerRef.current?.clientWidth || 900;
    const height = containerRef.current?.clientHeight || 640;
    const cx = width / 2;
    const cy = height / 2;

    const warmth = simulationWarmthRef.current;

    // 1. Strong pairwise repulsion (Coulomb force) to prevent clustering
    for (let i = 0; i < nodeList.length; i++) {
      const a = nodeList[i];
      for (let j = i + 1; j < nodeList.length; j++) {
        const b = nodeList[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy + 1;
        const dist = Math.sqrt(distSq);
        const minDist = a.radius + b.radius + 85; // Strict spacing buffer

        if (dist < 450) {
          // Strong push away if too close
          const repulsionFactor = dist < minDist ? 35000 : 20000;
          const force = (repulsionFactor / (distSq + 120)) * warmth;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (!a.isPinned && a !== draggingNodeRef.current) {
            a.vx -= fx;
            a.vy -= fy;
          }
          if (!b.isPinned && b !== draggingNodeRef.current) {
            b.vx += fx;
            b.vy += fy;
          }
        }
      }
    }

    // 2. Spring attraction along edges (Hooke's law with generous distance)
    const idealLength = 220;
    simEdges.forEach((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const delta = dist - idealLength;
      const force = delta * 0.025 * warmth;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!source.isPinned && source !== draggingNodeRef.current) {
        source.vx += fx;
        source.vy += fy;
      }
      if (!target.isPinned && target !== draggingNodeRef.current) {
        target.vx -= fx;
        target.vy -= fy;
      }
    });

    // 3. Gentle centering & damping for calm stabilization
    nodeList.forEach((node) => {
      if (node === draggingNodeRef.current) return;

      const toCenterDx = cx - node.x;
      const toCenterDy = cy - node.y;
      node.vx += toCenterDx * 0.002 * warmth;
      node.vy += toCenterDy * 0.002 * warmth;

      // Friction damping
      node.vx *= 0.85;
      node.vy *= 0.85;

      if (!node.isPinned) {
        node.x += node.vx;
        node.y += node.vy;
      }
    });

    // Slow down simulation warmth so graph settles still
    if (simulationWarmthRef.current > 0.05) {
      simulationWarmthRef.current *= 0.985;
    }

    pulseOffsetRef.current = (pulseOffsetRef.current + 0.015) % 1;
  }, [simEdges]);

  // Main canvas render loop
  useEffect(() => {
    let active = true;

    const render = () => {
      if (!active) return;
      updatePhysics();

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Graph container transform
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.scale, transform.scale);

      const nodeMap = simNodesRef.current;

      // Identify active node and connected elements
      const activeNode = selectedNodeId || hoveredNodeId;
      const connectedNodeIds = new Set<string>();
      const connectedEdgeIds = new Set<string>();

      if (activeNode) {
        connectedNodeIds.add(activeNode);
        simEdges.forEach((e) => {
          if (e.source === activeNode || e.target === activeNode) {
            connectedNodeIds.add(e.source);
            connectedNodeIds.add(e.target);
            connectedEdgeIds.add(e.id);
          }
        });
      }

      // 1. Draw Edges (Clean, sleek, uncluttered)
      simEdges.forEach((edge) => {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) return;

        const isDimmed = activeNode ? !connectedEdgeIds.has(edge.id) : false;
        const isHighlighted = activeNode ? connectedEdgeIds.has(edge.id) : false;
        const isEdgeHovered = hoveredEdgeId === edge.id;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return;

        // Subtle curve
        const cx = (source.x + target.x) / 2 - dy * 0.1;
        const cy = (source.y + target.y) / 2 + dx * 0.1;

        // Edge line
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(cx, cy, target.x, target.y);
        ctx.strokeStyle = isHighlighted || isEdgeHovered
          ? "#D5360C"
          : isDimmed
          ? "rgba(230,213,189, 0.03)"
          : "rgba(230,213,189, 0.12)";
        ctx.lineWidth = isHighlighted || isEdgeHovered ? 2.5 : 1.25;
        ctx.stroke();

        // Arrowhead pointing towards target
        const angle = Math.atan2(target.y - cy, target.x - cx);
        const arrowX = target.x - Math.cos(angle) * (target.radius + 4);
        const arrowY = target.y - Math.sin(angle) * (target.radius + 4);

        ctx.save();
        ctx.translate(arrowX, arrowY);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-7, -4);
        ctx.lineTo(-7, 4);
        ctx.closePath();
        ctx.fillStyle = isHighlighted || isEdgeHovered
          ? "#D5360C"
          : isDimmed
          ? "rgba(230,213,189, 0.05)"
          : "rgba(230,213,189, 0.25)";
        ctx.fill();
        ctx.restore();

        // DECLUTTERING KEY: Predicate badges ONLY appear on highlighted/hovered edges
        // This eliminates the messy overlapping boxes when all 20+ edges are rendered!
        if (isHighlighted || isEdgeHovered) {
          const midX = (source.x + target.x * 2 + cx) / 4;
          const midY = (source.y + target.y * 2 + cy) / 4;
          const label = edge.predicate.toLowerCase().replace(/_/g, " ");

          ctx.font = "bold 9px ui-monospace, SFMono-Regular, monospace";
          const textWidth = ctx.measureText(label).width;
          const pillW = textWidth + 12;
          const pillH = 17;

          ctx.save();
          ctx.fillStyle = "rgba(22,21,20, 0.95)";
          ctx.strokeStyle = "#D5360C";
          ctx.lineWidth = 1;

          ctx.beginPath();
          ctx.roundRect(midX - pillW / 2, midY - pillH / 2, pillW, pillH, 6);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#D5360C";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, midX, midY);
          ctx.restore();
        }
      });

      // 2. Draw Nodes (Spacious, clean badges, truncated legible labels)
      Array.from(nodeMap.values()).forEach((node) => {
        const isSelected = selectedNodeId === node.id;
        const isHovered = hoveredNodeId === node.id;
        const isDimmed = activeNode ? !connectedNodeIds.has(node.id) : false;

        const style = getEntityStyle(node.entityType);

        ctx.save();
        ctx.translate(node.x, node.y);

        // Halo ring on hover/selected
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(0, 0, node.radius + 8, 0, Math.PI * 2);
          ctx.fillStyle = style.ring;
          ctx.fill();
        }

        // Outer crisp circle
        ctx.beginPath();
        ctx.arc(0, 0, node.radius, 0, Math.PI * 2);
        ctx.strokeStyle = isDimmed
          ? "rgba(230,213,189, 0.05)"
          : isSelected
          ? "#F3E8D6"
          : node.color;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.fillStyle = isDimmed ? "rgba(16,16,16, 0.7)" : "#101010";
        ctx.fill();
        ctx.stroke();

        // Inner entity abbreviation (1-2 chars)
        const initial = (node.entityType[0] || "E").toUpperCase();
        ctx.font = `bold ${node.radius > 20 ? "11px" : "10px"} Inter, sans-serif`;
        ctx.fillStyle = isDimmed ? "rgba(169,154,134, 0.25)" : node.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initial, 0, 0);

        // Neat truncated label pill below node (max 14 chars to avoid overlapping)
        const label = truncateText(node.name, 14);
        ctx.font = "500 10.5px Inter, sans-serif";
        const labelMetrics = ctx.measureText(label);
        const lw = labelMetrics.width + 10;
        const lh = 17;
        const ly = node.radius + 12;

        ctx.beginPath();
        ctx.roundRect(-lw / 2, ly - lh / 2, lw, lh, 5);
        ctx.fillStyle = isDimmed ? "rgba(16,16,16, 0.5)" : "rgba(16,16,16, 0.88)";
        ctx.strokeStyle = isSelected
          ? "#D5360C"
          : isDimmed
          ? "rgba(230,213,189, 0.04)"
          : "rgba(230,213,189, 0.1)";
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isDimmed ? "rgba(169,154,134, 0.3)" : "#E6D5BD";
        ctx.fillText(label, 0, ly);

        ctx.restore();
      });

      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [updatePhysics, transform, selectedNodeId, hoveredNodeId, hoveredEdgeId, simEdges]);

  // Find node at screen coordinates
  const getNodeAtPosition = useCallback(
    (clientX: number, clientY: number): SimNode | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const mouseX = (clientX - rect.left - transform.x) / transform.scale;
      const mouseY = (clientY - rect.top - transform.y) / transform.scale;

      const nodesArray = Array.from(simNodesRef.current.values());
      for (let i = nodesArray.length - 1; i >= 0; i--) {
        const n = nodesArray[i];
        const dx = mouseX - n.x;
        const dy = mouseY - n.y;
        if (dx * dx + dy * dy <= (n.radius + 14) * (n.radius + 14)) {
          return n;
        }
      }
      return null;
    },
    [transform]
  );

  // Mouse interaction handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const node = getNodeAtPosition(e.clientX, e.clientY);
    if (node) {
      draggingNodeRef.current = node;
      setSelectedNodeId(node.id);
      simulationWarmthRef.current = 0.5; // wake up gently during drag
    } else {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingNodeRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - transform.x) / transform.scale;
      const y = (e.clientY - rect.top - transform.y) / transform.scale;
      draggingNodeRef.current.x = x;
      draggingNodeRef.current.y = y;
      draggingNodeRef.current.vx = 0;
      draggingNodeRef.current.vy = 0;
    } else if (isPanningRef.current) {
      setTransform((prev) => ({
        ...prev,
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      }));
    } else {
      const hovered = getNodeAtPosition(e.clientX, e.clientY);
      setHoveredNodeId(hovered ? hovered.id : null);
      if (hovered) {
        setTooltipPos({ x: e.clientX, y: e.clientY });
      } else {
        setTooltipPos(null);
      }
    }
  };

  const handleMouseUp = () => {
    draggingNodeRef.current = null;
    isPanningRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setTransform((prev) => {
      const newScale = Math.min(Math.max(prev.scale * zoomFactor, 0.35), 3.0);
      return {
        ...prev,
        scale: newScale,
      };
    });
  };

  const zoomIn = () => setTransform((p) => ({ ...p, scale: Math.min(p.scale * 1.2, 3.0) }));
  const zoomOut = () => setTransform((p) => ({ ...p, scale: Math.max(p.scale * 0.8, 0.35) }));
  const resetView = () => {
    setTransform({ x: 0, y: 0, scale: 1 });
    setSelectedNodeId(null);
    simulationWarmthRef.current = 0.8;
  };

  // Selected node details for Inspector drawer
  const selectedNode = selectedNodeId ? simNodesRef.current.get(selectedNodeId) : null;
  const hoveredNode = hoveredNodeId ? simNodesRef.current.get(hoveredNodeId) : null;

  const selectedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return simEdges.filter(
      (e) => e.source === selectedNodeId || e.target === selectedNodeId
    );
  }, [selectedNodeId, simEdges]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full h-[620px] rounded-2xl border border-white/10 bg-[#0C0B0A] overflow-hidden select-none shadow-2xl",
        className
      )}
    >
      {/* Top HUD: Summary Bar */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#161514]/90 backdrop-blur-md px-3.5 py-1.5 shadow-lg">
        <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
        <span className="font-mono text-xs font-semibold text-white">
          {nodes.length} Nodes
        </span>
        <span className="text-zinc-600">|</span>
        <span className="font-mono text-xs font-semibold text-zinc-300">
          {edges.length} Relationships
        </span>
      </div>

      {/* Top Floating Canvas Controls */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1 rounded-xl border border-white/10 bg-[#161514]/90 backdrop-blur-md p-1 shadow-lg">
        <button
          onClick={zoomIn}
          title="Zoom In"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition-colors"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={zoomOut}
          title="Zoom Out"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition-colors"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <div className="h-4 w-[1px] bg-white/10 mx-0.5" />
        <button
          onClick={resetView}
          title="Center & Reset View"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {/* Main Interactive Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Floating Hover Tooltip */}
      {hoveredNode && tooltipPos && !selectedNodeId && (
        <div
          className="fixed z-40 pointer-events-none -translate-x-1/2 -translate-y-full pb-3 animate-in fade-in zoom-in-95 duration-100"
          style={{ left: tooltipPos.x, top: tooltipPos.y - 10 }}
        >
          <div className="rounded-xl border border-white/15 bg-[#141312]/95 backdrop-blur-md px-3 py-2 shadow-2xl text-left max-w-xs">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: hoveredNode.color }}
              />
              <span className="font-mono text-[10px] uppercase font-bold text-zinc-400">
                {hoveredNode.entityType}
              </span>
              <span className="text-[10px] text-zinc-500 font-mono ml-auto">
                {hoveredNode.degree} link{hoveredNode.degree === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-xs font-semibold text-white leading-snug">{hoveredNode.name}</p>
          </div>
        </div>
      )}

      {/* Bottom Clean Institutional Legend */}
      <div className="absolute bottom-3 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        <div className="flex flex-wrap items-center gap-3.5 rounded-xl border border-white/10 bg-[#161514]/85 backdrop-blur-md px-3.5 py-1.5 pointer-events-auto">
          {[
            { label: "Customer", color: "#9DB38A" },
            { label: "Risk", color: "#EF6B57" },
            { label: "Competitor", color: "#D9A441" },
            { label: "Product", color: "#A7798A" },
            { label: "Action", color: "#C9A46A" },
            { label: "Metric", color: "#7F95A6" },
            { label: "Person", color: "#C07A66" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-[11px] text-zinc-300">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <div className="text-[11px] font-mono text-zinc-500 hidden md:block">
          Click node to inspect relationships · Drag to rearrange
        </div>
      </div>

      {/* Selected Entity Inspector Drawer */}
      {selectedNode && (
        <div className="absolute top-0 right-0 bottom-0 w-80 sm:w-96 border-l border-white/10 bg-[#161514]/95 backdrop-blur-2xl z-30 p-5 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: selectedNode.color }}
              />
              <span className="font-mono text-xs uppercase font-bold text-zinc-400">
                {selectedNode.entityType} Entity
              </span>
            </div>
            <button
              onClick={() => setSelectedNodeId(null)}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-4">
            <div>
              <h3 className="font-display text-base font-medium text-white tracking-tight leading-snug">
                {selectedNode.name}
              </h3>
              <p className="font-mono text-[11px] text-zinc-500 mt-1">ID: {selectedNode.id}</p>
            </div>

            {selectedNode.aliases.length > 0 && (
              <div>
                <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
                  Aliases & Tickers
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedNode.aliases.map((alias) => (
                    <span
                      key={alias}
                      className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 font-mono text-[11px] text-zinc-300"
                    >
                      {alias}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-2">
                Connected Relationships ({selectedEdges.length})
              </p>
              <div className="space-y-2">
                {selectedEdges.map((e) => {
                  const isOut = e.source === selectedNode.id;
                  const otherNodeId = isOut ? e.target : e.source;
                  const otherNode = simNodesRef.current.get(otherNodeId);

                  return (
                    <div
                      key={e.id}
                      className="p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:border-evidence/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="rounded px-2 py-0.5 bg-primary/15 border border-primary/30 text-[10px] font-mono font-bold text-primary uppercase">
                          {e.predicate.replace(/_/g, " ")}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {isOut ? "→ points to" : "← referenced by"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-white">
                          {otherNode?.name || otherNodeId}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-400">
                          conf: {(e.confidence * 100).toFixed(0)}%
                        </span>
                      </div>

                      {e.citation && (
                        <div className="mt-2.5 pt-2 border-t border-white/[0.06] flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
                            <FileText className="h-3 w-3 text-evidence" />
                            {e.citation.document_id}
                            {e.citation.page ? ` · p.${e.citation.page}` : ""}
                          </span>

                          {onOpenDocument && (
                            <button
                              onClick={() =>
                                onOpenDocument(e.citation!.document_id, e.citation!.page || 1)
                              }
                              className="text-[10px] text-evidence hover:underline flex items-center gap-1 font-medium cursor-pointer"
                            >
                              <span>Inspect</span>
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
