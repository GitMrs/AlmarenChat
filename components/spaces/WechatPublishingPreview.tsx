'use client';

import { forwardRef, useEffect, useMemo, useState } from 'react';
import { renderWechatArticleBody } from '@/lib/workspace/wechat/wechat-article-snapshot.mjs';
import { spaces as spacesApi } from '@/lib/client/api';
import type { SpaceFile } from '@/types';

const WechatPublishingPreview = forwardRef<HTMLDivElement, { content: string; themeId?: string; spaceId: string; files: SpaceFile[] }>(({ content, themeId, spaceId, files }, ref) => {
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [imageError, setImageError] = useState('');
  const rendered = useMemo(() => {
    try { return { ...renderWechatArticleBody(content, files, themeId, imageUrls), error: '' }; }
    catch (reason: any) { return { html: '', embeddedFiles: [], error: reason.message || '预览失败' }; }
  }, [content, files, themeId, imageUrls]);
  const imageKey = rendered.embeddedFiles.map((file) => file.id + ':' + (file.updatedAt || '')).join('|');
  useEffect(() => {
    let active = true;
    setImageUrls({});
    setImageError('');
    Promise.all(rendered.embeddedFiles.map(async (file) => {
      const blob = await spacesApi.downloadFile(spaceId, file.id);
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('正文图片读取失败'));
        reader.readAsDataURL(blob);
      });
      return [file.id, url];
    })).then((entries) => { if (active) setImageUrls(Object.fromEntries(entries)); })
      .catch((reason) => { if (active) setImageError(reason.message || '正文图片读取失败'); });
    return () => { active = false; };
  }, [spaceId, imageKey]);
  return <div>
    {(rendered.error || imageError) && <p role="alert" className="mb-4 text-sm text-rose-600">{rendered.error || imageError}</p>}
    <div ref={ref} data-wechat-preview-error={rendered.error || imageError || undefined} style={{ margin: '0 auto', maxWidth: '680px', overflowWrap: 'anywhere', color: '#374151', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }} dangerouslySetInnerHTML={{ __html: rendered.html }} />
  </div>;
});

WechatPublishingPreview.displayName = 'WechatPublishingPreview';
export default WechatPublishingPreview;
