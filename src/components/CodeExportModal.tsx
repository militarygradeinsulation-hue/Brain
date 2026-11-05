import React, { useState } from 'react';
import { X, Copy, Check, Code2, FileJson } from 'lucide-react';
import { MindprintProfile } from '../types';

interface CodeExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: MindprintProfile;
}

export const CodeExportModal: React.FC<CodeExportModalProps> = ({
  isOpen,
  onClose,
  profile,
}) => {
  const [activeTab, setActiveTab] = useState<'component' | 'json'>('component');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const jsonString = JSON.stringify(profile, null, 2);

  const embedSnippet = `// Mindprint 3D Anatomical Brain Stencil Component
// Dependencies: npm install three @types/three lucide-react
import { BrainCanvas } from './components/BrainCanvas';
import { generateAnatomicalBrainNetwork, brainSDF } from './utils/brainGeometry';

// Drop into your Mindprint report view (e.g. /reports/${profile.reportId || 'rep_nquupxz'}):
export function MindprintReportGraph({ profile, selectedNode, onSelectNode }) {
  return (
    <div className="relative w-full h-[640px] bg-black border border-white/15">
      <BrainCanvas
        profile={profile}
        selectedNode={selectedNode}
        onSelectNode={onSelectNode}
        activeCategory="All patterns"
        autoRotate={true}
        visualStyle="bw-stencil" // 'bw-stencil' | 'adobe-glow' | 'light-stencil'
        resetCameraTrigger={0}
      />
    </div>
  );
}`;

  const handleCopy = () => {
    const content = activeTab === 'component' ? embedSnippet : jsonString;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 font-mono">
      <div className="bg-zinc-950 border border-white/25 w-full max-w-2xl p-6 relative shadow-2xl text-white">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2 bg-white text-black">
            <Code2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold uppercase tracking-wider">
              Mindprint 3D Brain Integration Code
            </h2>
            <p className="text-xs text-zinc-400">
              Embed the 3D Anatomical Brain Stencil & Clickable Node Matrix into Mindprint
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-white/15 pb-3 mb-4">
          <div className="flex space-x-2">
            <button
              onClick={() => setActiveTab('component')}
              className={`px-3 py-1.5 text-xs flex items-center space-x-1.5 border ${
                activeTab === 'component'
                  ? 'bg-white text-black border-white font-bold'
                  : 'bg-zinc-900 text-zinc-300 border-white/15 hover:text-white'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>React 3D Integration</span>
            </button>
            <button
              onClick={() => setActiveTab('json')}
              className={`px-3 py-1.5 text-xs flex items-center space-x-1.5 border ${
                activeTab === 'json'
                  ? 'bg-white text-black border-white font-bold'
                  : 'bg-zinc-900 text-zinc-300 border-white/15 hover:text-white'
              }`}
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>Mindprint Nodes JSON ({profile.nodes.length} nodes)</span>
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="px-3 py-1.5 bg-white text-black hover:bg-zinc-200 text-xs font-bold flex items-center space-x-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'COPIED' : 'COPY CODE'}</span>
          </button>
        </div>

        <pre className="bg-black border border-white/15 p-4 text-xs text-zinc-300 overflow-x-auto max-h-96 leading-relaxed">
          <code>{activeTab === 'component' ? embedSnippet : jsonString}</code>
        </pre>
      </div>
    </div>
  );
};
