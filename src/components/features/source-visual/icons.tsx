import type { ReactNode, SVGProps } from 'react';

// Player-only glyphs in the same geometry as src/components/ui/Icon.tsx (24 grid, 2px stroke, round joins).
const paths = {
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.9-4.9M10.5 7.8v5.4M7.8 10.5h5.4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.9-4.9M7.8 10.5h5.4" />
    </>
  ),
  fit: <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />,
  eyeOff: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5c1.3 0 2.5.3 3.5.8M21.5 12S18 18.5 12 18.5c-1.3 0-2.5-.3-3.5-.8" />
      <path d="M4 4l16 16" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4Z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  message: <path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8A1.5 1.5 0 0 1 19 16.5h-7l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" />,
  arrowLeft: <path d="M19 12H5m6-6-6 6 6 6" />,
  arrowRight: <path d="M5 12h14m-6-6 6 6-6 6" />,
  home: <path d="M4 11 12 4l8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5Z" />,
} satisfies Record<string, ReactNode>;

export type ExtraIconName = keyof typeof paths;

export function ExtraIcon({ name, size = 24, ...rest }: { name: ExtraIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
