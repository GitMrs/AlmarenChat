import type { Metadata } from 'next';
import CompanionPreview from '@/components/companion/CompanionPreview';
import './companion.css';

export const metadata: Metadata = {
  title: '陪伴预览 · AlmarenChat',
  robots: { index: false, follow: false },
};

export default function CompanionPage() {
  return <CompanionPreview />;
}
