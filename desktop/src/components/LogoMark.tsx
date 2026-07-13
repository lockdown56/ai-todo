import type { SVGProps } from "react";

export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect width="64" height="64" rx="15" fill="#5B5CE2" />
      <path
        d="M40.8 19.2h-17c-3.4 0-6.1 2.7-6.1 6.1V41c0 3.4 2.7 6.1 6.1 6.1h15.7c3.4 0 6.1-2.7 6.1-6.1v-4.7"
        fill="none"
        stroke="#FFFDF7"
        strokeWidth="5.2"
        strokeLinecap="round"
      />
      <path
        d="m23.8 32.5 7.6 7.6L47.3 22"
        fill="none"
        stroke="#FFFDF7"
        strokeWidth="6.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
