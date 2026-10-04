import type { CSSProperties } from "react";
import type { Company } from "@/data/atlas/companies";
import sprite from "@/data/atlas/logos.json";
import { DomainGlyph } from "./glyphs";

const CELL = new Map(sprite.ids.map((id, i) => [id, i]));

/** The company's logo, a tile cut from public/atlas/logos.webp (scripts/atlas/build_logos.py),
 *  ringed in its domain's colour. CSS sizes it (`--logo`) unless `size` is given. */
export function CompanyLogo({ company, size }: { company: Pick<Company, "id" | "domain">; size?: number }) {
  const i = CELL.get(company.id);
  if (i === undefined) return <DomainGlyph domain={company.domain} size={size} />;
  const col = i % sprite.cols;
  const row = Math.floor(i / sprite.cols);
  const style = {
    backgroundSize: `${sprite.cols * 100}% ${sprite.rows * 100}%`,
    backgroundPosition: `${(col / (sprite.cols - 1)) * 100}% ${(row / (sprite.rows - 1)) * 100}%`,
    ...(size ? { "--logo": `${size}px` } : null),
  } as CSSProperties;
  return <span className="logo" data-domain={company.domain} aria-hidden="true" style={style} />;
}
