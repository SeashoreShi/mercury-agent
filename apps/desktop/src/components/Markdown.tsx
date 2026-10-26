import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

/** The agent's answers. Code blocks get a copy button; links open outside. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose" data-selectable>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const node = document.activeElement?.closest?.("pre") ?? null;
    const text = extractText(children) || node?.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked */ }
  }
  return (
    <div className="group relative">
      <pre>{children}</pre>
      <button
        onClick={() => void copy()}
        className="absolute right-2 top-2 rounded-md border border-line bg-surface p-1 text-ink3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) return extractText((node as { props: { children?: React.ReactNode } }).props.children);
  return "";
}
