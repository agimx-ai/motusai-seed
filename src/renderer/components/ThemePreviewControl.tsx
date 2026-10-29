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
          <span className="seed-theme-preview__search" />
          <span className="seed-theme-preview__installed">
            {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
          </span>
          <span className="seed-theme-preview__catalog">
            {Array.from({ length: 4 }, (_, index) => (
              <span className="seed-theme-preview__plugin" key={index}>
                <span className="seed-theme-preview__plugin-icon" />
                <span className="seed-theme-preview__plugin-label" />
              </span>
            ))}
          </span>
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
      <span className={`seed-theme-preview seed-theme-preview--${option.value}`}>
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
