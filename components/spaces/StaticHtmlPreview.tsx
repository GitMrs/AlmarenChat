import { STATIC_HTML_SANDBOX } from '@/lib/static-html-sandbox.mjs';

export default function StaticHtmlPreview({
  title,
  entryUrl,
}: {
  title: string;
  entryUrl: string;
}) {
  return (
    <iframe
      title={`${title} 预览`}
      sandbox={STATIC_HTML_SANDBOX}
      referrerPolicy="no-referrer"
      src={entryUrl}
      className="block h-full w-full border-0 bg-white"
    />
  );
}
