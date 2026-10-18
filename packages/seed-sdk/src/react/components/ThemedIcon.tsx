import { useMemo } from 'react';
import { cx } from '../utils';
import './ThemedIcon.css';

// Only SVGs whose paint explicitly inherits currentColor are masks. Fixed brand
// colors, raster images and complex SVG paint keep their original pixels.
export function isCurrentColorIcon(dataUrl: string): boolean {
  if (dataUrl.length > 350_000 || !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) return false;
  try {
    const svg = atob(dataUrl.slice(dataUrl.indexOf(',') + 1)).replace(/<!--[\s\S]*?-->/g, '');
    if (
      !/<svg\b/i.test(svg) ||
      /<(?:style|image|use|foreignObject|filter|linearGradient|radialGradient|pattern|animate\w*|set)\b/i.test(svg) ||
      /\bstyle\s*=\s*["'][^"']*(?:fill|stroke|color|background|filter)\s*:/i.test(svg)
    )
      return false;
    const paints = Array.from(svg.matchAll(/\s(?:fill|stroke|color)\s*=\s*["']([^"']*)["']/gi), (match) =>
      match[1]!.trim().toLowerCase(),
    );
    return paints.includes('currentcolor') && paints.every((paint) => paint === 'currentcolor' || paint === 'none');
  } catch {
    return false;
  }
}

export function ThemedIcon({
  iconDataUrl,
  iconDarkDataUrl,
  className,
}: {
  iconDataUrl: string;
  iconDarkDataUrl?: string;
  className?: string;
}) {
  const monochrome = useMemo(() => !iconDarkDataUrl && isCurrentColorIcon(iconDataUrl), [iconDataUrl, iconDarkDataUrl]);
  return (
    <span
      className={cx('seed-themed-icon inline-block h-4 w-4 shrink-0', className)}
      aria-hidden="true"
      style={
        monochrome
          ? {
              backgroundColor: 'currentColor',
              maskImage: `url("${iconDataUrl}")`,
              maskSize: 'contain',
              maskPosition: 'center',
              maskRepeat: 'no-repeat',
            }
          : undefined
      }
    >
      {!monochrome && (
        <>
          <img
            src={iconDataUrl}
            alt=""
            className={cx('h-full w-full object-contain', iconDarkDataUrl && 'seed-themed-icon-light')}
          />
          {iconDarkDataUrl && (
            <img src={iconDarkDataUrl} alt="" className="seed-themed-icon-dark h-full w-full object-contain" />
          )}
        </>
      )}
    </span>
  );
}
