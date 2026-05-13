interface Props {
  workspaceUrl: string;
  brandUrl?: string;
  brandName?: string;
  crossPromo?: Array<{ name: string; href: string; tagline?: string }>;
}

const DEFAULT_BRAND = "ailuxis.com";
const DEFAULT_BRAND_URL = "https://ailuxis.com";
const DEFAULT_PROMO: Array<{ name: string; href: string }> = [];

export function Footer({
  workspaceUrl,
  brandUrl = DEFAULT_BRAND_URL,
  brandName = DEFAULT_BRAND,
  crossPromo = DEFAULT_PROMO,
}: Props) {
  return (
    <footer className="prixma-footer">
      <span className="prixma-footer-left">
        PrixmaViz — an <a href={brandUrl} target="_blank" rel="noopener">{brandName}</a> product
      </span>
      <span className="prixma-footer-center">
        {crossPromo.length > 0 && <span className="prixma-footer-promo-label">Also try: </span>}
        {crossPromo.map((p) => (
          <a key={p.name} href={p.href} target="_blank" rel="noopener" className="prixma-footer-chip">
            {p.name}
          </a>
        ))}
      </span>
      <span className="prixma-footer-right">
        <a href={workspaceUrl} className="prixma-footer-url">{workspaceUrl}</a>
      </span>
    </footer>
  );
}
