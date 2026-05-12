interface PromoCard {
  name: string;
  href: string;
  tagline: string;
}

interface Props {
  cards: PromoCard[];
}

export function EmptyStateCards({ cards }: Props) {
  if (cards.length === 0) return null;
  return (
    <div className="empty-state-promo">
      <p className="empty-state-promo-label">While you wait, check out other Alexis products:</p>
      <div className="empty-state-promo-cards">
        {cards.map((c) => (
          <a key={c.name} className="empty-state-promo-card" href={c.href} target="_blank" rel="noopener">
            <strong>{c.name}</strong>
            <span>{c.tagline}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
