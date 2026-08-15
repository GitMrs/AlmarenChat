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
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={entryUrl}
      className="block h-full w-full border-0 bg-white"
    />
  );
}
