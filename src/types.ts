export type CategoryType =
  | 'All patterns'
  | 'How they think'
  | 'Decisions'
  | 'Trust'
  | 'Expressed drivers'
  | 'Workplace friction'
  | 'Deeper hypotheses'
  | 'Work events';

export type BrainVisualStyle = 'bw-stencil' | 'adobe-glow' | 'light-stencil';

export interface MindprintNode {
  id: string;
  label: string;
  fullTitle?: string;
  region?: string;
  category: CategoryType;
  x: number;
  y: number;
  z: number;
  significance: 'High' | 'Medium' | 'Core';
  description: string;
  citations: number;
  connections: string[]; // target node IDs
}

export interface MindprintProfile {
  id: string;
  reportId?: string;
  name: string;
  role: string;
  title: string;
  subtitle: string;
  coreOverview: string;
  unlockedQuestions: string[];
  nodes: MindprintNode[];
}
