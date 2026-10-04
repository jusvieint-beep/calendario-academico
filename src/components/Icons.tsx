import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const SessionIcon = (p: P) => (
  <svg {...base} {...p}><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="M15.5 10.5l6-3.5v10l-6-3.5z" /></svg>
);
export const DeliveryIcon = (p: P) => (
  <svg {...base} {...p}><path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" /><path d="M14 2.5v5h5" /><path d="M9 14.5l2 2 4-4" /></svg>
);
export const SunIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const MoonIcon = (p: P) => (
  <svg {...base} {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
);
export const UploadIcon = (p: P) => (
  <svg {...base} strokeWidth={1.8} {...p}><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" /><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>
);
export const DownloadIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M4 19h16" /></svg>
);
export const FileIcon = (p: P) => (
  <svg {...base} strokeWidth={1.8} {...p}><path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" /><path d="M14 2.5v5h5" /><path d="M9 12l5 6M14 12l-5 6" /></svg>
);
export const AlertIcon = (p: P) => (
  <svg {...base} {...p}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
);
export const OkIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9.5" /><path d="M8 12.5l2.7 2.7L16 10" /></svg>
);
export const ErrorIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9.5" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
);

export const CategoryIcon = ({ category, ...p }: P & { category: 'SESION' | 'ENTREGA' }) =>
  category === 'SESION' ? <SessionIcon {...p} /> : <DeliveryIcon {...p} />;
