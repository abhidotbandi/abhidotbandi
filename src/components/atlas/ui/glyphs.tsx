import type { DomainId } from "@/data/atlas/domains";

/** Shape per domain, so identity never rests on colour alone. 16×16, drawn in currentColor. */
export function DomainGlyph({ domain, size = 14 }: { domain: DomainId; size?: number }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" data-domain={domain}>
      {domain === "defense-space" && <path d="M8 1.5 14.2 13.6 8 10.6 1.8 13.6Z" fill="currentColor" />}
      {domain === "chips-compute" && (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" stroke="none" />
          <path d="M6.2 1.6v1.6M9.8 1.6v1.6M6.2 12.8v1.6M9.8 12.8v1.6M1.6 6.2h1.6M1.6 9.8h1.6M12.8 6.2h1.6M12.8 9.8h1.6" />
        </g>
      )}
      {domain === "energy-mobility" && <path d="M9.6 1 3.2 9.2h4.1L6.2 15l6.6-8.4H8.6Z" fill="currentColor" />}
      {domain === "robotics-mfg" && (
        <path
          fillRule="evenodd"
          d="M8 1.2 13.9 4.6v6.8L8 14.8 2.1 11.4V4.6Zm0 4.4a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}
