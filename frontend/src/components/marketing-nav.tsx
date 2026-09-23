import Link from "next/link";

const links = [
  ["Services", "/services"],
  ["Demos", "/demos"],
  ["Books", "/books"],
  ["Products", "/ecosystem"],
  ["About", "/about"],
  ["Contact", "/contact"],
] as const;

function NavigationLinks() {
  return <>
    {links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
    <Link href="/workspaces" className="public-client-link">Client access</Link>
    <Link href="/contact" className="public-button">Let’s talk</Link>
  </>;
}

export function MarketingNav() {
  return <>
    <nav aria-label="Main navigation" className="public-nav public-desktop-nav">
      <NavigationLinks />
    </nav>
    <details className="public-mobile-menu">
      <summary>Menu <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h16M4 18h16" /></svg></summary>
      <nav aria-label="Main navigation" className="public-nav">
        <NavigationLinks />
      </nav>
    </details>
  </>;
}
