import Link from 'next/link';
import type { ReactNode } from 'react';
import ThemeToggle from './ThemeToggle';

interface Props {
  appName: string;
  subtitle: string;
  right?: ReactNode;
  href?: string;
}

export default function Header({ appName, subtitle, right, href = '/' }: Props) {
  return (
    <header className="topbar">
      <Link className="brand" href={href}>
        <div className="brand-mark" aria-hidden="true" />
        <div>
          <div className="brand-text">{appName}</div>
          <div className="brand-sub">{subtitle}</div>
        </div>
      </Link>
      <div className="top-actions">
        {right}
        <ThemeToggle />
      </div>
    </header>
  );
}
