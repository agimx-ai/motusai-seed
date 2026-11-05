import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@motus-ai/seed-sdk/react';
import { SidebarToggleButton } from './SidebarToggleButton';

export function WindowNavigation({ canGoBack, canGoForward, onBack, onForward, showSidebarToggle, collapsed, onToggle, className }: {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  showSidebarToggle: boolean;
  collapsed: boolean;
  onToggle: () => void;
  className: string;
}) {
  const { t } = useTranslation();
  const buttonClass = 'rounded-[8px] enabled:hover:bg-muted';
  return (
    <div className={`flex items-center gap-1 [-webkit-app-region:no-drag] ${className}`}>
      <IconButton icon={<ArrowLeft size={16} strokeWidth={1.7} />} label={t('nav.goBack')}
        disabled={!canGoBack} onClick={onBack} className={buttonClass} />
      <IconButton icon={<ArrowRight size={16} strokeWidth={1.7} />} label={t('nav.goForward')}
        disabled={!canGoForward} onClick={onForward} className={buttonClass} />
      {showSidebarToggle && <SidebarToggleButton collapsed={collapsed} onToggle={onToggle} />}
    </div>
  );
}
