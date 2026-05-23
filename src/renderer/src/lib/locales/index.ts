import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import zhCommon from './zh-CN/common.json';
import zhSidebar from './zh-CN/sidebar.json';
import zhChat from './zh-CN/chat.json';
import zhSettings from './zh-CN/settings.json';
import zhPanels from './zh-CN/panels.json';
import zhKanban from './zh-CN/kanban.json';
import zhTabs from './zh-CN/tabs.json';

import enCommon from './en-US/common.json';
import enSidebar from './en-US/sidebar.json';
import enChat from './en-US/chat.json';
import enSettings from './en-US/settings.json';
import enPanels from './en-US/panels.json';
import enKanban from './en-US/kanban.json';
import enTabs from './en-US/tabs.json';

const savedLang =
  typeof window !== 'undefined'
    ? (localStorage.getItem('openwork-language') as string) || 'zh-CN'
    : 'zh-CN';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': {
        common: zhCommon,
        sidebar: zhSidebar,
        chat: zhChat,
        settings: zhSettings,
        panels: zhPanels,
        kanban: zhKanban,
        tabs: zhTabs,
      },
      'en-US': {
        common: enCommon,
        sidebar: enSidebar,
        chat: enChat,
        settings: enSettings,
        panels: enPanels,
        kanban: enKanban,
        tabs: enTabs,
      },
    },
    lng: savedLang,
    fallbackLng: 'en-US',
    ns: ['common', 'sidebar', 'chat', 'settings', 'panels', 'kanban', 'tabs'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
    missingKeyHandler: (lngs, ns, key) => {
      console.warn(`[i18n] Missing key: ${ns}:${key} for language: ${lngs.join(',')}`);
    },
  });

export default i18n;