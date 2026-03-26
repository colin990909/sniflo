import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/components/CopyButton";

let highlighterPromise: Promise<import("shiki").Highlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: ["github-dark-default", "github-light-default"],
        langs: [
          "json", "javascript", "typescript", "html", "css",
          "bash", "shell", "http", "python", "rust", "sql", "yaml", "xml",
        ],
      }),
    );
  }
  return highlighterPromise;
}

function detectTheme(): "github-dark-default" | "github-light-default" {
  return document.documentElement.classList.contains("dark")
    ? "github-dark-default"
    : "github-light-default";
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const { t } = useTranslation();
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getHighlighter().then((highlighter) => {
      if (cancelled) return;

      const loadedLangs = highlighter.getLoadedLanguages();
      const lang = language && loadedLangs.includes(language) ? language : "text";

      const result = highlighter.codeToHtml(code, {
        lang,
        theme: detectTheme(),
      });
      setHtml(result);
    }).catch(() => {
      // Fallback: no highlighting
    });

    return () => { cancelled = true; };
  }, [code, language]);

  return (
    <div className="group/code relative my-2 max-w-full overflow-x-auto rounded-lg border border-border bg-background text-xs">
      <div className="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover/code:opacity-100">
        <CopyButton text={code} label={t("ai.code.copy")} className="rounded-md bg-background/80 backdrop-blur-sm" />
      </div>
      {html ? (
        <div
          className="overflow-x-auto [&>pre]:!m-0 [&>pre]:!bg-transparent [&>pre]:p-3 [&>pre]:leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="whitespace-pre-wrap break-words p-3 leading-relaxed text-foreground [overflow-wrap:anywhere]">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
