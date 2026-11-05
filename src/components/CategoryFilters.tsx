import React from 'react';
import { CategoryType } from '../types';

interface CategoryFiltersProps {
  activeCategory: CategoryType;
  onSelectCategory: (cat: CategoryType) => void;
  totalNodesCount: number;
}

const CATEGORIES: CategoryType[] = [
  'All patterns',
  'How they think',
  'Decisions',
  'Trust',
  'Expressed drivers',
  'Workplace friction',
  'Deeper hypotheses',
  'Work events',
];

export const CategoryFilters: React.FC<CategoryFiltersProps> = ({
  activeCategory,
  onSelectCategory,
  totalNodesCount,
}) => {
  return (
    <div className="w-full px-4 py-2 bg-black border-b border-white/10 flex flex-wrap items-center justify-between gap-2 font-mono">
      <div className="flex flex-wrap items-center gap-1.5">
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => onSelectCategory(cat)}
              className={`px-3 py-1.5 text-xs transition-colors border ${
                isActive
                  ? 'bg-zinc-900 text-white border-white font-semibold'
                  : 'bg-black text-zinc-400 border-white/15 hover:border-white/40 hover:text-zinc-200'
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      <div className="text-[11px] text-zinc-400 hidden xl:block">
        {totalNodesCount} active neural patterns mapped in 3D brain
      </div>
    </div>
  );
};
