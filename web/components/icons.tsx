/**
 * A small inline icon set, Phosphor-flavoured. Inline SVG rather than an icon font from a CDN — the same
 * reason the vouchers are content-addressed: nothing on these pages should quietly depend on a third
 * party's server to render.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth={16}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const LedgerIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="48" y="48" width="72" height="72" rx="12" />
    <rect x="136" y="48" width="72" height="72" rx="12" />
    <rect x="48" y="136" width="72" height="72" rx="12" />
    <rect x="136" y="136" width="72" height="72" rx="12" />
  </Base>
);

export const BagIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M48 80h160l-12 128a16 16 0 0 1-16 14H76a16 16 0 0 1-16-14Z" />
    <path d="M88 80a40 40 0 0 1 80 0" />
  </Base>
);

export const TagIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M122 40H48a8 8 0 0 0-8 8v74a8 8 0 0 0 2.3 5.7l88 88a8 8 0 0 0 11.4 0l74-74a8 8 0 0 0 0-11.4l-88-88A8 8 0 0 0 122 40Z" />
    <circle cx="84" cy="84" r="10" fill="currentColor" stroke="none" />
  </Base>
);

export const BellIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M64 112a64 64 0 0 1 128 0c0 48 20 60 20 60H44s20-12 20-60Z" />
    <path d="M108 216a24 24 0 0 0 40 0" />
  </Base>
);

export const GearIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="128" cy="128" r="40" />
    <path d="M128 24v24M128 208v24M52 52l17 17M187 187l17 17M24 128h24M208 128h24M52 204l17-17M187 69l17-17" />
  </Base>
);

export const SearchIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="112" cy="112" r="72" />
    <path d="M168 168l48 48" />
  </Base>
);

export const CaretDownIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M64 104l64 64 64-64" />
  </Base>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M40 128h176M144 56l72 72-72 72" />
  </Base>
);

export const TrendUpIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M224 88l-88 88-40-40-64 64" />
    <path d="M168 88h56v56" />
  </Base>
);

export const TrendDownIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M224 168l-88-88-40 40-64-64" />
    <path d="M168 168h56v-56" />
  </Base>
);

export const ShieldIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M40 56l88-32 88 32v56c0 88-88 120-88 120S40 200 40 112Z" />
  </Base>
);

export const BoltIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M96 240l16-80-56-24L160 16l-16 80 56 24Z" />
  </Base>
);

/** The universal sidebar toggle: a panel, with the rail it hides drawn in. */
export const SidebarIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="40" y="48" width="176" height="160" rx="16" />
    <path d="M100 48v160" />
  </Base>
);

export const GlobeIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="128" cy="128" r="96" />
    <path d="M32 128h192" />
    <path d="M128 32c34 30 34 162 0 192c-34-30-34-162 0-192Z" />
  </Base>
);

export const StackIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M24 94l104-54 104 54-104 54Z" />
    <path d="M24 146l104 54 104-54" />
  </Base>
);

export const UserIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="128" cy="92" r="52" />
    <path d="M34 216a100 100 0 0 1 188 0" />
  </Base>
);

export const StorefrontIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M44 122v86h168v-86" />
    <path d="M24 94l18-54h172l18 54H24Z" />
    <path d="M104 208v-52h48v52" />
  </Base>
);

export const UsersIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="92" cy="104" r="44" />
    <path d="M18 204a84 84 0 0 1 148 0" />
    <path d="M168 62a44 44 0 0 1 0 84" />
    <path d="M190 130a84 84 0 0 1 48 74" />
  </Base>
);

/** The rest of the row, folded — the standard "there is more here" of a compact list. */
export const DotsIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="128" cy="60" r="14" fill="currentColor" stroke="none" />
    <circle cx="128" cy="128" r="14" fill="currentColor" stroke="none" />
    <circle cx="128" cy="196" r="14" fill="currentColor" stroke="none" />
  </Base>
);

/** The rail, folded away — the phone's door back into the map. */
export const MenuIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M40 72h176" />
    <path d="M40 128h176" />
    <path d="M40 184h176" />
  </Base>
);

export const CloseIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M64 64l128 128" />
    <path d="M192 64L64 192" />
  </Base>
);
