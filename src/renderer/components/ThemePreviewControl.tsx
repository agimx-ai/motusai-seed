import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@motus-ai/seed-sdk/react';
import appLogoDarkUrl from '../../../resources/app/app-dark.svg?url';
import appLogoLightUrl from '../../../resources/app/app-light.svg?url';
import type { ResolvedTheme, ThemePreference } from '../hooks/use-theme';
import './ThemePreviewControl.css';

function ThemeWindow({ theme }: { theme: ResolvedTheme }) {
  return (
    <span className={`seed-theme-preview__variant seed-theme-preview__variant--${theme}`}>
      <span className="seed-theme-preview__window">
        <span className="seed-theme-preview__sidebar">
          <img src={theme === 'dark' ? appLogoDarkUrl : appLogoLightUrl} alt="" />
        </span>
        <span className="seed-theme-preview__content">
          <span className="seed-theme-preview__line seed-theme-preview__line--first" />
          <span className="seed-theme-preview__line seed-theme-preview__line--second" />
          <span className="seed-theme-preview__line seed-theme-preview__line--third" />
          <span className="seed-theme-preview__line seed-theme-preview__line--fourth" />
          <span className="seed-theme-preview__line seed-theme-preview__line--fifth" />
          <span className="seed-theme-preview__line seed-theme-preview__line--sixth" />
          <span className="seed-theme-preview__composer"><span /></span>
        </span>
      </span>
    </span>
  );
}

export function ThemePreviewControl({
  value,
  resolvedTheme,
  onValueChange,
}: {
  value: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onValueChange: (value: ThemePreference) => void;
}) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const options = [
    { value: 'system' as const, label: t('settings.themeSystem') },
    { value: 'light' as const, label: t('settings.themeLight') },
    { value: 'dark' as const, label: t('settings.themeDark') },
  ].map((option) => ({
    ...option,
    icon: (
      <span className={`seed-theme-preview seed-theme-preview--${option.value}`} title={option.label}>
        {option.value !== 'dark' && <ThemeWindow theme="light" />}
        {option.value !== 'light' && <ThemeWindow theme="dark" />}
      </span>
    ),
  }));

  return (
    <div>
      <span id={descriptionId} className="sr-only">
        {t('settings.currentTheme', {
          theme: resolvedTheme === 'dark' ? t('settings.themeDark') : t('settings.themeLight'),
        })}
      </span>
      <SegmentedControl
        className="seed-theme-previews"
        label={t('settings.theme')}
        aria-describedby={descriptionId}
        value={value}
        options={options}
        onValueChange={onValueChange}
      />
    </div>
  );
}
