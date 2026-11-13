import { createContext, useContext } from "react";

export type Lang = "fa" | "en";

export interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (fa: string, en: string) => string;
}

export const LangContext = createContext<LangContextValue>({
  lang: "fa",
  setLang: () => undefined,
  t: (fa) => fa,
});

export function useLang(): LangContextValue {
  return useContext(LangContext);
}

export function isRtl(lang: Lang): boolean {
  return lang === "fa";
}
