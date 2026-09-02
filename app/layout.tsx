import type { Metadata } from 'next';
import './globals.css';
import PersonalAssistantProvider from '@/components/assistant/PersonalAssistantProvider';

export const metadata: Metadata = {
  title: 'AlmarenChat - 发现你的 AI 搭档',
  description: '发现、创建并聊天你的专属 AI Agent',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased"><PersonalAssistantProvider>{children}</PersonalAssistantProvider></body>
    </html>
  );
}
