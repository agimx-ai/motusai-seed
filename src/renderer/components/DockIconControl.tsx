import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@motus-ai/seed-sdk/react';
import type { SeedDockIconDesignGeneration, SeedDockIconPreference } from '../../shared/contracts';
import light26IconUrl from '../../../resources/app/dock-icons/26/light-preview.png?url';
import dark26IconUrl from '../../../resources/app/dock-icons/26/dark-preview.png?url';
import light27IconUrl from '../../../resources/app/dock-icons/27/light-preview.png?url';
import dark27IconUrl from '../../../resources/app/dock-icons/27/dark-preview.png?url';
import './DockIconControl.css';

export function DockIconControl({ value, designGeneration = 26, onValueChange }: {
  value: SeedDockIconPreference;
  designGeneration?: SeedDockIconDesignGeneration;
  onValueChange: (value: SeedDockIconPreference) => void;
}) {
  const { t } = useTranslation();
  const lightIconUrl = designGeneration === 27 ? light27IconUrl : light26IconUrl;
  const darkIconUrl = designGeneration === 27 ? dark27IconUrl : dark26IconUrl;
  const options = [
    { value: 'system' as const, label: t('settings.themeSystem') },
    { value: 'light' as const, label: t('settings.themeLight') },
    { value: 'dark' as const, label: t('settings.themeDark') },
  ].map((option) => ({
    ...option,
    icon: <span className={`seed-dock-icon seed-dock-icon--${option.value}`} aria-hidden="true">
      {option.value !== 'dark' && <img className="seed-dock-icon__light" src={lightIconUrl} alt="" />}
      {option.value !== 'light' && <img className="seed-dock-icon__dark" src={darkIconUrl} alt="" />}
    </span>,
  }));
  return <SegmentedControl className="seed-dock-icons" label={t('settings.dockIcon')} value={value} options={options} onValueChange={onValueChange} />;
}
