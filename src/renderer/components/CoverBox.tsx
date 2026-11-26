import React, { useState } from "react";
import type { MediaInfo } from "@shared/types";
import { useLang } from "../i18n";
import { formatBytes } from "../format";
import { Button } from "./ui";

/**
 * Cover preview. The file is stored and exported byte-for-byte (no resize, no
 * re-encode), so the preview shows the real resolution and size and warns when
 * the source itself is small enough to look soft on a phone screen.
 */
export function CoverBox({
  coverUrl,
  media,
  busy,
  onSelect,
  onRemove,
}: {
  coverUrl: string | null;
  media: MediaInfo | null | undefined;
  busy: boolean;
  onSelect: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const { t } = useLang();
  const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null);
  const natural = size && size.url === coverUrl ? size : null;
  const low = natural ? Math.min(natural.width, natural.height) < 512 : false;
  const format = media?.coverMimeType?.replace("image/", "").toUpperCase();
  return (
    <div className="cover-box">
      {coverUrl ? (
        <img
          src={coverUrl}
          alt="cover"
          className="cover-preview"
          decoding="async"
          onLoad={(event) => {
            const image = event.currentTarget;
            setSize({ url: coverUrl, width: image.naturalWidth, height: image.naturalHeight });
          }}
        />
      ) : (
        <div className="cover-placeholder">COVER</div>
      )}
      {coverUrl ? (
        <div className={`cover-facts${low ? " is-low" : ""}`} dir="ltr">
          {natural ? <span>{natural.width}×{natural.height}</span> : null}
          {format ? <span>{format}</span> : null}
          {media?.coverBytes ? <span>{formatBytes(media.coverBytes)}</span> : null}
        </div>
      ) : null}
      {coverUrl ? (
        <p className={`cover-note${low ? " is-low" : ""}`}>
          {low
            ? t("تصویر منبع کوچک است؛ برای وضوح بهتر در گوشی، دست‌کم ۱۰۲۴ پیکسل پیشنهاد می‌شود.", "The source image is small; 1024 px or more looks sharper on phones.")
            : t("بدون فشرده‌سازی و تغییر اندازه، با کیفیت اصلی در پکیج قرار می‌گیرد.", "Shipped in the pack at original quality — no resize, no recompression.")}
        </p>
      ) : null}
      <div className="row gap-sm">
        <Button size="sm" variant="ghost" onClick={onSelect} disabled={busy}>
          {media?.coverPath ? t("تعویض کاور", "Replace cover") : t("انتخاب کاور", "Select cover")}
        </Button>
        {media?.coverPath ? (
          <Button size="sm" variant="ghost" onClick={onRemove} disabled={busy}>
            {t("حذف", "Remove")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
