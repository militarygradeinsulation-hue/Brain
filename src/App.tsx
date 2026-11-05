import React, { useState } from 'react';
import { Header } from './components/Header';
import { BrainCanvas } from './components/BrainCanvas';
import { NodeDetailDrawer } from './components/NodeDetailDrawer';
import { CategoryFilters } from './components/CategoryFilters';
import { AiGeneratorModal } from './components/AiGeneratorModal';
import { CodeExportModal } from './components/CodeExportModal';
import { DEFAULT_MINDPRINTS } from './data/defaultMindprints';
import { MindprintProfile, MindprintNode, CategoryType, BrainVisualStyle } from './types';

export default function App() {
  const [profiles, setProfiles] = useState<MindprintProfile[]>(DEFAULT_MINDPRINTS);
  const [currentProfileId, setCurrentProfileId] = useState<string>(DEFAULT_MINDPRINTS[0].id);
  const [selectedNode, setSelectedNode] = useState<MindprintNode | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryType>('All patterns');
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [visualStyle, setVisualStyle] = useState<BrainVisualStyle>('bw-stencil');
  const [heatmapMode, setHeatmapMode] = useState<boolean>(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState<boolean>(false);
  const [resetCameraTrigger, setResetCameraTrigger] = useState<number>(0);

  const currentProfile = profiles.find((p) => p.id === currentProfileId) || profiles[0];

  const handleSelectProfile = (id: string) => {
    setCurrentProfileId(id);
    setSelectedNode(null);
    setActiveCategory('All patterns');
  };

  const handleGeneratedProfile = (newProfile: MindprintProfile) => {
    setProfiles((prev) => [newProfile, ...prev]);
    setCurrentProfileId(newProfile.id);
    setSelectedNode(null);
    setActiveCategory('All patterns');
  };

  const handleResetCamera = () => {
    setSelectedNode(null);
    setResetCameraTrigger((prev) => prev + 1);
  };

  const filteredNodesCount = currentProfile.nodes.filter(
    (n) => activeCategory === 'All patterns' || n.category === activeCategory
  ).length;

  const totalSharedLinks = currentProfile.nodes.reduce(
    (sum, n) => sum + n.connections.length,
    0
  );

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-black text-white select-none font-mono">
      {/* Top Mindprint Report Bar */}
      <Header
        currentProfile={currentProfile}
        profiles={profiles}
        onSelectProfile={handleSelectProfile}
        onOpenAiModal={() => setIsAiModalOpen(true)}
        onOpenCodeModal={() => setIsCodeModalOpen(true)}
        onResetCamera={handleResetCamera}
        autoRotate={autoRotate}
        onToggleAutoRotate={() => setAutoRotate(!autoRotate)}
        visualStyle={visualStyle}
        onChangeVisualStyle={setVisualStyle}
        heatmapMode={heatmapMode}
        onToggleHeatmap={() => setHeatmapMode((prev) => !prev)}
      />

      {/* Category Filter Tabs Row (Matches Screenshot 1) */}
      <CategoryFilters
        activeCategory={activeCategory}
        onSelectCategory={(cat) => setActiveCategory(cat)}
        totalNodesCount={filteredNodesCount}
      />

      {/* Main Split Workspace: Left = 3D Human Brain Stencil Viewport, Right = Thinking Core Inspector */}
      <main className="flex-1 flex flex-col lg:flex-row min-h-0 p-3 gap-3 bg-black">
        {/* Left Column: 3D Human Brain Viewport & Footer Status */}
        <div className="flex-1 flex flex-col min-h-[380px] border border-white/15 bg-black relative overflow-hidden">
          <div className="flex-1 relative min-h-0">
            <BrainCanvas
              profile={currentProfile}
              selectedNode={selectedNode}
              onSelectNode={(node) => setSelectedNode(node)}
              activeCategory={activeCategory}
              autoRotate={autoRotate}
              visualStyle={visualStyle}
              resetCameraTrigger={resetCameraTrigger}
              heatmapMode={heatmapMode}
              onToggleHeatmap={() => setHeatmapMode((prev) => !prev)}
            />
          </div>

          {/* Bottom-Left Telemetry Strip matching Screenshot 1 */}
          <div className="px-4 py-2 bg-zinc-950 border-t border-white/10 text-xs text-zinc-400 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <span>{currentProfile.nodes.length} evidence-backed patterns</span>
              <span>•</span>
              <span>{totalSharedLinks} shared-citation links</span>
              <span>•</span>
              <span className="text-zinc-200">Tap a node to inspect</span>
            </div>
            <div className="text-[11px] text-zinc-500 hidden sm:block">
              3D Anatomical Human Brain Network (Frontal • Parietal • Temporal • Occipital • Cerebellum • Brainstem)
            </div>
          </div>
        </div>

        {/* Right Column: CORE OVERVIEW / THINKING CORE Panel */}
        <NodeDetailDrawer
          profile={currentProfile}
          selectedNode={selectedNode}
          onSelectNode={(node) => setSelectedNode(node)}
          activeCategory={activeCategory}
        />
      </main>

      {/* AI Mindprint Generator Modal */}
      <AiGeneratorModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        onGenerated={handleGeneratedProfile}
      />

      {/* Export Code for Mindprint Integration Modal */}
      <CodeExportModal
        isOpen={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
        profile={currentProfile}
      />
    </div>
  );
}
