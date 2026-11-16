import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ObsidianIntegrationCard } from './ObsidianIntegrationCard';

export function AppIntegrationsSection() {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mb-7 mt-4">
      <h3 id={headingId} className="mb-2 px-2 text-[16px] font-medium">{t('plugins.integrationsSection')}</h3>
      <ObsidianIntegrationCard />
    </section>
  );
}
