/**
 * Issue #7 Wave 2 (F3) — active tag-filter chips row.
 *
 * Renders one chip per active tag with an X to remove. A "Clear all" link
 * appears when 2+ filters are active. Hidden entirely when no filters are
 * active so the surrounding layout collapses to zero height.
 *
 * The list filtering itself happens in the Library (AND semantics over the
 * `activeTagFilters` set) — this component is presentation + remove
 * controls only.
 */
import { useAppStore } from "../../store";

export function FilterChips() {
  const activeTagFilters = useAppStore((s) => s.activeTagFilters);
  const removeTagFilter = useAppStore((s) => s.removeTagFilter);
  const clearTagFilters = useAppStore((s) => s.clearTagFilters);

  if (activeTagFilters.size === 0) return null;

  // Sort for stable rendering — Sets preserve insertion order in modern
  // engines, but rendering in alpha order makes the chip row look intentional.
  const tags = [...activeTagFilters].sort();

  return (
    <div
      className="library-filter-chips"
      role="region"
      aria-label="Active tag filters"
      data-testid="library-filter-chips"
    >
      <span className="library-filter-chips-label">Filters:</span>
      {tags.map((tag) => (
        <span key={tag} className="library-filter-chip" data-testid={`filter-chip-${tag}`}>
          <span className="library-filter-chip-text">{tag}</span>
          <button
            type="button"
            className="library-filter-chip-remove"
            aria-label={`Remove filter ${tag}`}
            title={`Remove filter ${tag}`}
            onClick={() => removeTagFilter(tag)}
          >
            ×
          </button>
        </span>
      ))}
      {tags.length >= 2 && (
        <button
          type="button"
          className="library-filter-chips-clear"
          onClick={clearTagFilters}
          data-testid="filter-chips-clear-all"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
