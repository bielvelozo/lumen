import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </Icon>
);

export const ChatIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
  </Icon>
);

export const DatabaseIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </Icon>
);

export const KeyIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="8" cy="15" r="4.5" />
    <path d="m11.2 11.8 8.3-8.3M17 6l3 3M14.5 8.5l2 2" />
  </Icon>
);

export const AuditIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17" />
  </Icon>
);

export const PlusIcon = (p: IconProps): JSX.Element => (
  <Icon strokeWidth={2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const SendIcon = (p: IconProps): JSX.Element => (
  <Icon strokeWidth={2} {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Icon>
);

export const LockIcon = (p: IconProps): JSX.Element => (
  <Icon strokeWidth={2} {...p}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);

export const CheckIcon = (p: IconProps): JSX.Element => (
  <Icon strokeWidth={2.5} {...p}>
    <path d="m5 12 5 5 9-10" />
  </Icon>
);

export const CopyIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps): JSX.Element => (
  <Icon strokeWidth={2} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const LogoutIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" />
  </Icon>
);
