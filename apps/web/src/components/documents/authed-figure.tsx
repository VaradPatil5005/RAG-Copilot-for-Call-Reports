"use client";

import { useEffect, useState } from "react";
import { getFigureBlob } from "@/lib/api";

/** Renders a document figure fetched with the user's bearer token. */
export function AuthedFigure({
  documentId,
  figurePath,
  alt,
  className,
}: {
  documentId: string;
  figurePath: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    getFigureBlob(documentId, figurePath)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [documentId, figurePath]);

  if (failed) return <p className="text-[11px] text-text-faint">Figure unavailable</p>;
  if (!src) return <div className={className} aria-busy="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}
