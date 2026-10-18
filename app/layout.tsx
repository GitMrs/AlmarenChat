import type { Metadata, Viewport } from 'next';
import './globals.css';
import PersonalAssistantProvider from '@/components/assistant/PersonalAssistantProvider';
import GlobalToastContainer from '@/components/shared/GlobalToastContainer';

export const metadata: Metadata = {
  title: 'AlmarenChat - 发现你的 AI 搭档',
  description: '发现、创建并聊天你的专属 AI Agent',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <PersonalAssistantProvider>{children}</PersonalAssistantProvider>
        <GlobalToastContainer />
      </body>
    </html>
  );
}
