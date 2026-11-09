import { Link, NavLink } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import logo from "../assets/logo.svg";
import logoDark from "../assets/logo-dark.svg";
import { ICONS } from "../assets/icons";
import { flipTheme, useTheme } from "../theme";

export function Icon({ name, size = 24, label }: { name: string; size?: number; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? "" }}
    />
  );
}

export function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <>
      <img src={logo} width={size} height={size} alt="" className={`only-light ${className}`} />
      <img src={logoDark} width={size} height={size} alt="" className={`only-dark ${className}`} />
    </>
  );
}

function ThemeToggle() {
  const isDark = useTheme() === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  const Glyph = isDark ? Sun : Moon;
  return (
    <button type="button" className="theme-toggle" onClick={flipTheme} aria-label={label} title={label}>
      <Glyph size={20} strokeWidth={1.75} />
    </button>
  );
}

export function Header() {
  return (
    <header className="site-header">
      <div className="wrap">
        <Link to="/" className="brand" aria-label="MorphoNup home">
          <Logo />
          <span>MorphoNup</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/predict">Predict</NavLink>
          <NavLink to="/datasets">Datasets</NavLink>
          <NavLink to="/about">About</NavLink>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <span>MorphoNup, a CMSC 199.2 thesis at the University of the Philippines Tacloban.</span>
        <span>
          <a href="https://github.com/normaneulin/MorphoNup">Model code</a>
          <a href="https://github.com/normaneulin/MorphoNup-Web">Website code</a>
        </span>
      </div>
    </footer>
  );
}

export const SPECIES_ICON: Record<string, string> = {
  "Homo sapiens": "homo-sapiens",
  "Caenorhabditis elegans": "c-elegans",
  "Drosophila melanogaster": "d-melanogaster",
  "Saccharomyces cerevisiae": "s-cerevisiae",
};

export const REGION_ICON: Record<string, string> = {
  benchmark: "balanced-benchmark",
  "genome-wide": "genome-wide",
  "largest-chromosome": "largest-chromosome",
  promoter: "promoter",
  "five-prime-utr": "five-prime-utr",
  "whole-genome": "whole-genome",
};
