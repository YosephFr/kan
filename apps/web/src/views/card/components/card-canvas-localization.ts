const EXCALIDRAW_LOCALES: Record<string, string> = {
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  nl: "nl-NL",
  pl: "pl-PL",
  ptbr: "pt-BR",
  ru: "ru-RU",
};

export const getExcalidrawLanguage = (locale: string) =>
  EXCALIDRAW_LOCALES[locale] ?? "en";
