import Link from "next/link";
import { brand } from "@/lib/brand";
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M30 8H16c-5 0-8 3-8 8v16l9-8c2-2 3-4 2-6s-5-2-6 1c-1 4 3 8 8 8 7 0 12-5 12-12 0-3-1-5-3-7Z"
        stroke="currentColor"
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function Logo() {
  return (
    <Link className="logo" href="/" aria-label={`${brand.name} home`}>
      <Mark />
      <span>
        {brand.name}
        <span className="logo-period">.</span>
      </span>
    </Link>
  );
}
