import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/lib/store';
import { Globe } from 'lucide-react';

const LANGUAGES = [
  { code: 'zh-CN' as const, label: '中文' },
  { code: 'en-US' as const, label: 'English' },
];

export function LanguageSelector(): React.JSX.Element {
  const { language, setLanguage } = useAppStore();
  const { t } = useTranslation('settings');

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <Globe className="h-3.5 w-3.5" />
        <span>{t('settingsHub.languageLabel')}</span>
      </div>
      <div className="flex items-center gap-2">
        {LANGUAGES.map(({ code, label }) => (
          <button
            key={code}
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              language === code
                ? 'bg-primary text-primary-foreground'
                : 'border border-[var(--border-muted)] bg-background-elevated text-[var(--text-secondary)] hover:bg-background-interactive'
            }`}
            onClick={() => setLanguage(code)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}