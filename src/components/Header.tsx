import React from 'react';
import { Sparkles, RotateCcw, Code2, Orbit, Palette } from 'lucide-react';
import { MindprintProfile, BrainVisualStyle } from '../types';

interface HeaderProps {
  currentProfile: MindprintProfile;
  profiles: MindprintProfile[];
  onSelectProfile: (id: string) => void;
  onOpenAiModal: () => void;
  onOpenCodeModal: () => void;
  onResetCamera: () => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  visualStyle: BrainVisualStyle;
  onChangeVisualStyle: (style: BrainVisualStyle) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentProfile,
  profiles,
  onSelectProfile,
  onOpenAiModal,
  onOpenCodeModal,
  onResetCamera,
  autoRotate,
  onToggleAutoRotate,
  visualStyle,
  onChangeVisualStyle,
}) => {
  return (
    <header className="w-full z-30 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-zinc-950 border-b border-white/15 text-white font-mono">
      {/* Left: Mindprint Report Mode Tabs + Subject Selector (Matches Screenshot 1) */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center border border-white/20 bg-black">
          <span className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-zinc-400 border-r border-white/15">
            QUICK REPORT
          </span>
          <span className="px-3 py-1.5 text-[11px] uppercase tracking-wider bg-[#e5a970] text-black font-bold border-r border-white/15">
            FULL REPORT
          </span>
          <span className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-zinc-400">
            INTEL REPORT
          </span>
        </div>

        <div className="hidden lg:flex items-center space-x-1 bg-zinc-900 border border-white/15 p-0.5">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectProfile(p.id)}
              className={`px-2.5 py-1 text-[11px] transition-colors ${
                currentProfile.id === p.id
                  ? 'bg-white text-black font-bold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {p.reportId || p.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Center: 3D Brain Stencil Aesthetic Selector */}
      <div className="flex items-center space-x-1 bg-zinc-900 border border-white/15 p-0.5">
        <Palette className="w-3.5 h-3.5 text-zinc-400 mx-1.5" />
        <button
          onClick={() => onChangeVisualStyle('bw-stencil')}
          className={`px-2.5 py-1 text-[11px] transition-colors ${
            visualStyle === 'bw-stencil'
              ? 'bg-white text-black font-bold'
              : 'text-zinc-300 hover:text-white'
          }`}
        >
          B&W Stencil
        </button>
        <button
          onClick={() => onChangeVisualStyle('adobe-glow')}
          className={`px-2.5 py-1 text-[11px] transition-colors ${
            visualStyle === 'adobe-glow'
              ? 'bg-white text-black font-bold'
              : 'text-zinc-300 hover:text-white'
          }`}
        >
          Neural Gold/Cyan
        </button>
        <button
          onClick={() => onChangeVisualStyle('light-stencil')}
          className={`px-2.5 py-1 text-[11px] transition-colors ${
            visualStyle === 'light-stencil'
              ? 'bg-white text-black font-bold'
              : 'text-zinc-300 hover:text-white'
          }`}
        >
          White Stencil
        </button>
      </div>

      {/* Right: Orbit, Reset, Export Code, AI Scan */}
      <div className="flex items-center space-x-2">
        <button
          onClick={onToggleAutoRotate}
          className={`flex items-center space-x-1.5 px-2.5 py-1.5 border text-[11px] transition-colors ${
            autoRotate
              ? 'bg-white text-black border-white font-bold'
              : 'bg-zinc-900 border-white/20 text-zinc-300 hover:text-white'
          }`}
        >
          <Orbit className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">3D SPIN {autoRotate ? 'ON' : 'OFF'}</span>
        </button>

        <button
          onClick={onResetCamera}
          title="Reset 3D View"
          className="flex items-center space-x-1 px-2.5 py-1.5 bg-zinc-900 border border-white/20 hover:border-white text-[11px] text-zinc-300 hover:text-white transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden md:inline">RESET</span>
        </button>

        <button
          onClick={onOpenCodeModal}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-zinc-900 border border-white/30 hover:border-white text-[11px] text-white transition-colors"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">GET CODE</span>
        </button>

        <button
          onClick={onOpenAiModal}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-white text-black hover:bg-zinc-200 text-[11px] font-bold transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI SCAN</span>
        </button>
      </div>
    </header>
  );
};
