import type { SVGProps } from 'react';
import type { Kind } from '@/lib/types';

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

export const ForumIcon = (p: P) => (
  <svg {...base} {...p}><path d="M14.5 4.5h-10a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2H6v3l3.5-3h5a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2z" /><path d="M16.5 8.5h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H18v2.5l-3-2.5h-3.5a2 2 0 0 1-1.6-.8" /></svg>
);

/** Grabación: pantalla con botón de reproducir. */
export const RecordingIcon = (p: P) => (
  <svg {...base} {...p}><rect x="2.5" y="4.5" width="19" height="13" rx="2.5" /><path d="M10 8.3v5.4l4.6-2.7z" /><path d="M8 21h8" /></svg>
);

/** Dudas: globo de chat con signo de pregunta. */
export const DoubtsIcon = (p: P) => (
  <svg {...base} {...p}><path d="M20.5 11.5a8 8 0 0 1-11.6 7.1L3.5 20l1.4-4.6A8 8 0 1 1 20.5 11.5z" /><path d="M10.1 9.3a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 2-2.2 3.1" /><path d="M12.3 15.8h.01" /></svg>
);

/** Cuestionario: hoja de examen con respuestas marcadas. */
export const QuizIcon = (p: P) => (
  <svg {...base} {...p}><rect x="5" y="3.5" width="14" height="18" rx="2.5" /><path d="M9.5 2.5h5v2.5h-5z" /><path d="M8.5 10l1.2 1.2 2.1-2.4" /><path d="M14 10h2" /><path d="M8.5 15.5l1.2 1.2 2.1-2.4" /><path d="M14 15.5h2" /></svg>
);

/** Sesión Zajuna y Sesión adicional comparten la cámara (son sesiones); el color las diferencia. */
export const CategoryIcon = ({ category, ...p }: P & { category: Kind }) =>
  category === 'SESION_ZAJUNA' || category === 'SESION_ADICIONAL' ? <SessionIcon {...p} />
  : category === 'DUDAS' ? <DoubtsIcon {...p} />
  : category === 'GRABACION' ? <RecordingIcon {...p} />
  : category === 'FORO' ? <ForumIcon {...p} />
  : category === 'CUESTIONARIO' ? <QuizIcon {...p} />
  : <DeliveryIcon {...p} />;

export const LockIcon = (p: P) => (
  <svg {...base} {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
);
