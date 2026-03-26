import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  iconSize?: number;
}

export function CopyButton({ text, label, className = "", iconSize = 12 }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      aria-label={label ?? "Copy"}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground ${className}`}
    >
      {copied ? <Check size={iconSize} className="text-green-500" /> : <Copy size={iconSize} />}
      {label && <span className="ml-1 hidden sm:inline">{label}</span>}
    </button>
  );
}
