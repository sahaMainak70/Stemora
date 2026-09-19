type WebDocument = {
  createElement(tag: string): WebAnchor;
  body: { appendChild(node: unknown): void; removeChild(node: unknown): void };
};

type WebAnchor = {
  href: string;
  download: string;
  click(): void;
};

export function triggerWebDownload(url: string, filename: string): boolean {
  const doc = (globalThis as { document?: WebDocument }).document;
  if (!doc) return false;
  const link = doc.createElement("a");
  link.href = url;
  link.download = filename;
  doc.body.appendChild(link);
  link.click();
  doc.body.removeChild(link);
  return true;
}