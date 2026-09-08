'use client';

import { cn } from '@/lib/utils';
import { resolveAgentAvatar } from '@/lib/agent-avatar';

interface AvatarProps {
  src?: string;
  alt: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClasses = {
  sm: 'w-5 h-5 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-14 h-14 text-xl',
  xl: 'w-20 h-20 text-3xl',
};

function isUrl(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:') || str.startsWith('/');
}

export default function Avatar({ src, alt, size = 'md', className }: AvatarProps) {
  const initials = alt.charAt(0).toUpperCase();
  const generatedSrc = src ? resolveAgentAvatar(src) : null;

  // No src — show initials
  if (!src) {
    return (
      <div
        className={cn(
          'rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold ring-2 ring-white shadow-sm',
          sizeClasses[size],
          className
        )}
      >
        {initials}
      </div>
    );
  }

  // URL — render as image
  if (generatedSrc || isUrl(src)) {
    return (
      <img
        src={generatedSrc || src}
        alt={alt}
        className={cn(
          'rounded-full object-cover ring-2 ring-white shadow-sm',
          sizeClasses[size],
          className
        )}
      />
    );
  }

  // Emoji — render as text
  return (
    <div
      className={cn(
        'rounded-full bg-gray-50 flex items-center justify-center ring-2 ring-white shadow-sm',
        sizeClasses[size],
        className
      )}
    >
      {src}
    </div>
  );
}
