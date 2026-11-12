import type { ReactNode, SVGProps } from 'react';

// One line-icon set (Lucide-style geometry, 2px stroke, rounded joins). Decorative by default.
const paths = {
  warn: (
    <>
      <path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.2h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 3 3 5-6" />
    </>
  ),
  doubleCheck: (
    <>
      <circle cx="12" cy="12" r="9" strokeDasharray="3.2 3" />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5" />
      <path d="M12 16.6h.01" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  dashedSquare: <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3.5 3" />,
  crossCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  wrench: (
    <path d="M14.7 6.3a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3l6.7-6.7ZM14.7 6.3a4 4 0 0 1 5-1.6L17.2 7.2l-.4 1.9 1.9.4 2.5-2.5" />
  ),
  page: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M9 10h6M9 14h4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  more: (
    <>
      <path d="M12 5.5h.01M12 12h.01M12 18.5h.01" />
    </>
  ),
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M18.5 14a5 5 0 0 1 2.5 4.5v1" />
    </>
  ),
  levels: <path d="M6 20v-5M12 20v-9M18 20V5" />,
  pageQuestion: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M9.8 9.8a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.4M12 16.2h.01" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 24,
  ...rest
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
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
