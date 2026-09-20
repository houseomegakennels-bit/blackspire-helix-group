import Link from "next/link";
const links = [
  ["Services", "/services"],
  ["Demos", "/demos"],
  ["About", "/about"],
  ["Contact", "/contact"],
] as const;
export function MarketingNav() {
  return (
    <nav aria-label="Main navigation" className="public-nav">
      {links.map(([label, href]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
      <Link href="/workspaces" className="public-client-link">
        Client access
      </Link>
      <Link href="/contact" className="public-button">
        Let’s talk
      </Link>
    </nav>
  );
}
