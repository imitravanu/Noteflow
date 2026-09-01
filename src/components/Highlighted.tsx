import { highlightParts } from "../utils/highlight";

interface HighlightedProps {
  text: string;
  query: string | null | undefined;
}

/** Renders text with search matches wrapped in <mark>. */
export function Highlighted({ text, query }: HighlightedProps) {
  const parts = highlightParts(text, query);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

