import React, { useState } from 'react';
import { X, Sparkles, Brain, Loader2 } from 'lucide-react';
import { MindprintProfile } from '../types';

interface AiGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (newProfile: MindprintProfile) => void;
}

export const AiGeneratorModal: React.FC<AiGeneratorModalProps> = ({
  isOpen,
  onClose,
  onGenerated,
}) => {
  const [profileName, setProfileName] = useState('');
  const [profileText, setProfileText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim() || !profileText.trim()) {
      setError('Please provide both a subject name and a profile description/resume.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/generate-mindprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileTitle: profileName,
          profileText,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to generate mindprint');
      }

      const data = await res.json();

      const newProfile: MindprintProfile = {
        id: `custom-${Date.now()}`,
        name: profileName,
        role: data.subtitle || 'Custom Analyzed Subject',
        title: data.title || 'NEURAL STENCIL MATRIX',
        subtitle: data.subtitle || 'Custom cognitive behavioral analysis profile.',
        coreOverview: data.coreOverview || profileText,
        unlockedQuestions: data.unlockedQuestions || [
          'What are the primary decision-making criteria in high-stress scenarios?',
          'How does this individual align operational autonomy with long-term vision?'
        ],
        nodes: data.nodes || [],
      };

      onGenerated(newProfile);
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error communicating with AI generator.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 font-mono">
      <div className="bg-black border border-white/30 w-full max-w-xl p-6 relative shadow-[0_0_50px_rgba(255,255,255,0.15)] text-white">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-6">
          <div className="p-2.5 bg-white text-black font-bold">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight uppercase">AI Mindprint Matrix Generator</h2>
            <p className="text-xs text-zinc-400">Powered by Gemini AI • 3D Neural Stencil Analysis</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-zinc-300 mb-1">
              Subject Name & Title
            </label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="e.g. Marcus Thorne, Chief Technology Officer"
              className="w-full bg-zinc-900 border border-white/20 p-3 text-sm text-white focus:outline-none focus:border-white"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-zinc-300 mb-1">
              Profile, Bio, Resume, or Leadership Notes
            </label>
            <textarea
              rows={5}
              value={profileText}
              onChange={(e) => setProfileText(e.target.value)}
              placeholder="Paste executive bio, interview transcript, leadership philosophy, or resume here. Gemini will parse evidence-backed patterns and map them into 3D neural nodes..."
              className="w-full bg-zinc-900 border border-white/20 p-3 text-sm text-white focus:outline-none focus:border-white resize-none"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-950/50 border border-red-500 text-red-200 text-xs">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-white/20 text-xs text-zinc-300 hover:text-white hover:border-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-white text-black hover:bg-zinc-200 text-xs font-bold flex items-center space-x-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating 3D Brain Matrix...</span>
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4" />
                  <span>Generate Mindprint</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
