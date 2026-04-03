import Vue from 'vue';
import VueI18n from 'vue-i18n';
import en from './locales/en.json';
import zh from './locales/zh.json';

Vue.use(VueI18n);

const i18n = new VueI18n({
  locale: 'zh', // 默认语言设置为中文
  fallbackLocale: 'en',
  messages: {
    en,
    zh,
  },
  silentTranslationWarn: true, // 静默翻译警告
  silentFallbackWarn: true, // 静默回退警告
});

export default i18n;
