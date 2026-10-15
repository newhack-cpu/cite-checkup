import type { Metadata } from "next";
// 字体全部自托管：Google Fonts 在国内不稳定，中文字体按字符分片加载，只下载页面用到的字
import "@fontsource-variable/noto-serif-sc/wght.css";
import "lxgw-wenkai-webfont/lxgwwenkai-regular.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "引用体检 · 论文参考文献核查",
  description: "导入PDF与Word核查参考文献真实性、信息与撤稿状态，并用可追溯的原文证据核查正文论断。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
