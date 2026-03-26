import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import zhHans from "./zh-Hans.json";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-Hans": { translation: zhHans },
  },
  lng: navigator.language.startsWith("zh") ? "zh-Hans" : "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function applyLanguagePreference(lang: string) {
  if (lang === "system") {
    const detected = navigator.language.startsWith("zh") ? "zh-Hans" : "en";
    i18n.changeLanguage(detected);
  } else {
    i18n.changeLanguage(lang);
  }
}

export default i18n;
