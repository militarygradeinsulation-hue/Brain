import React from 'react';
import { Network, ArrowRight, RotateCcw, MapPin } from 'lucide-react';
import { MindprintNode, MindprintProfile } from '../types';

interface NodeDetailDrawerProps {
  profile: MindprintProfile;
  selectedNode: MindprintNode | null;
  onSelectNode: (node: MindprintNode | null) => void;
  activeCategory: string;
}

export const NodeDetailDrawer: React.FC<NodeDetailDrawerProps> = ({
  profile,
  selectedNode,
  onSelectNode,
  activeCategory,
}) => {
  return (
    <aside className="w-full lg:w-[400px] xl:w-[440px] h-full bg-black border border-white/15 flex flex-col text-white font-mono overflow-hidden shrink-0">
      {/* Top Header matching Screenshot 1: CORE OVERVIEW / THINKING CORE */}
      <div className="p-5 border-b border-white/10 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2 text-[11px] text-zinc-400 uppercase tracking-widest">
            <Network className="w-3.5 h-3.5 text-zinc-300" />
            <span>{selectedNode ? 'NEURAL NODE EVIDENCE' : 'CORE OVERVIEW'}</span>
          </div>
          <h2 className="text-lg font-bold tracking-wider uppercase text-white mt-1">
            {selectedNode ? selectedNode.fullTitle || selectedNode.label : profile.title}
          </h2>
        </div>

        {selectedNode && (
          <button
            onClick={() => onSelectNode(null)}
            className="px-2.5 py-1 border border-white/20 hover:border-white text-xs text-zinc-300 hover:text-white flex items-center space-x-1 transition-colors shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Core</span>
          </button>
        )}
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {selectedNode ? (
          <div className="space-y-5">
            {/* Category & Anatomical Brain Lobe Badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider px-2.5 py-0.5 bg-white text-black font-bold">
                {selectedNode.category}
              </span>
              {selectedNode.region && (
                <span className="text-[11px] px-2.5 py-0.5 bg-zinc-900 border border-white/20 text-zinc-300 flex items-center space-x-1">
                  <MapPin className="w-3 h-3 text-white" />
                  <span>{selectedNode.region}</span>
                </span>
              )}
            </div>

            {/* Evidence Pattern Description */}
            <div className="p-4 bg-zinc-950 border border-white/15 space-y-2">
              <span className="text-[11px] text-zinc-400 uppercase tracking-widest block">
                OBSERVED EVIDENCE PATTERN
              </span>
              <p className="text-zinc-200 text-sm leading-relaxed font-sans">
                {selectedNode.description}
              </p>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 bg-zinc-950 border border-white/10">
                <span className="text-[10px] text-zinc-400 block uppercase">Weight</span>
                <span className="text-sm font-bold text-white">{selectedNode.significance}</span>
              </div>
              <div className="p-3 bg-zinc-950 border border-white/10">
                <span className="text-[10px] text-zinc-400 block uppercase">Citations</span>
                <span className="text-sm font-bold text-white">{selectedNode.citations} links</span>
              </div>
              <div className="p-3 bg-zinc-950 border border-white/10">
                <span className="text-[10px] text-zinc-400 block uppercase">Synapses</span>
                <span className="text-sm font-bold text-white">
                  {selectedNode.connections.length} nodes
                </span>
              </div>
            </div>

            {/* Connected Neural Pathways */}
            {selectedNode.connections.length > 0 && (
              <div className="space-y-2.5">
                <span className="text-[11px] uppercase tracking-widest text-zinc-400 block">
                  SHARED-CITATION SYNAPTIC LINKS ({selectedNode.connections.length})
                </span>
                <div className="space-y-1.5">
                  {selectedNode.connections.map((targetId) => {
                    const targetNode = profile.nodes.find((n) => n.id === targetId);
                    if (!targetNode) return null;
                    return (
                      <button
                        key={targetId}
                        onClick={() => onSelectNode(targetNode)}
                        className="w-full text-left p-2.5 bg-zinc-950 hover:bg-zinc-900 border border-white/15 hover:border-white/50 flex items-center justify-between group transition-colors"
                      >
                        <div className="min-w-0 pr-2">
                          <span className="text-xs text-white font-semibold block truncate">
                            {targetNode.fullTitle || targetNode.label}
                          </span>
                          <span className="text-[10px] text-zinc-400 block truncate">
                            {targetNode.region || targetNode.category}
                          </span>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-zinc-500 group-hover:text-white shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Default Thinking Core Overview (Matches Screenshot 1) */
          <div className="space-y-6">
            <p className="text-zinc-200 text-sm leading-relaxed font-mono">
              {profile.coreOverview}
            </p>

            <div className="space-y-3 pt-2 border-t border-white/10">
              <span className="text-[11px] uppercase tracking-widest text-zinc-300 font-bold block">
                QUESTIONS THAT UNLOCK DEEPER UNDERSTANDING
              </span>
              <ul className="space-y-2.5 text-xs text-zinc-300 leading-relaxed">
                {profile.unlockedQuestions.map((q, idx) => (
                  <li key={idx} className="flex items-start space-x-2">
                    <span className="text-white font-bold">•</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Interactive List of 3D Brain Nodes */}
            <div className="space-y-2.5 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-widest text-zinc-400">
                  ANATOMICAL 3D BRAIN NODES ({profile.nodes.length})
                </span>
                <span className="text-[10px] text-zinc-500">Click to inspect</span>
              </div>
              <div className="space-y-1.5">
                {profile.nodes
                  .filter(
                    (n) => activeCategory === 'All patterns' || n.category === activeCategory
                  )
                  .map((node) => (
                    <button
                      key={node.id}
                      onClick={() => onSelectNode(node)}
                      className="w-full text-left p-2.5 bg-zinc-950 hover:bg-white hover:text-black border border-white/10 flex items-center justify-between group transition-colors"
                    >
                      <div className="truncate pr-2">
                        <span className="text-xs font-bold block truncate">
                          {node.fullTitle || node.label}
                        </span>
                        <span className="text-[10px] text-zinc-400 group-hover:text-zinc-700 block truncate">
                          {node.region ? `${node.region} • ${node.category}` : node.category}
                        </span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 bg-white/10 group-hover:bg-black group-hover:text-white border border-white/15 shrink-0">
                        {node.citations}c
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
