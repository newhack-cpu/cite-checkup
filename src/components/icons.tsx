// 界面用的线性图标：24 网格、1.8 描边，跟随文字颜色。只放这个页面真正用到的几个。
import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {children}
    </svg>
  );
}

export const IconArrow = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const IconChevron = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M6 9l6 6 6-6" /></Icon>;
export const IconClip = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M20.5 11.6l-8.4 8.4a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.8 1.8 0 0 1-2.5-2.5l7.8-7.8" /></Icon>;
export const IconCamera = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M3.5 8.5a2 2 0 0 1 2-2h2.2l1.6-2.2h5.4l1.6 2.2h2.2a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="3.4" /></Icon>;
export const IconCopy = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Icon>;
export const IconDownload = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></Icon>;
export const IconCheck = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
export const IconSpark = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" /><path d="M19 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></Icon>;
export const IconStop = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></Icon>;
export const IconShield = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 3.5l7 2.6v5.3c0 4.3-2.9 7.6-7 9.1-4.1-1.5-7-4.8-7-9.1V6.1z" /><path d="M9 12l2.2 2.2L15.5 10" /></Icon>;
