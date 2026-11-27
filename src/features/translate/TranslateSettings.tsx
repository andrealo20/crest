import { settings, updateSettings } from "../../settings/store";
import { Group, Row, Select, Switch } from "../../ui/controls";
import { lang, locale, t } from "../../i18n";
import { modelCode } from "../now-playing/offline";
import { LANGS } from "./logic";

/** Settings > Tools: the Translate tool's target language and the provider set in Ask. Shown once the tool is on. */
export function TranslateSettings() {
  const s = settings.use();
  if (!s.tools.some((x) => x.id === "translate" && x.enabled)) return null;
  const names = new Intl.DisplayNames([lang()], { type: "language" });
  const nameOf = (code: string) => {
    const name = names.of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(locale()) + name.slice(1);
  };
  const own = modelCode(lang());
  const set = (patch: Partial<typeof s.translate>) => updateSettings((cur) => ({ translate: { ...cur.translate, ...patch } }));
  return (
    <Group id="settings-translate" title={t("Übersetzen")}>
      <Row icon="language" label={t("Zielsprache")} hint={t("Wohin das Tool übersetzt, solange du dort keine andere wählst")}>
        <Select
          value={LANGS.includes(s.translate.target) ? s.translate.target : ""}
          options={[
            { value: "", label: t("Sprache von Crest ({name})", { name: nameOf(LANGS.includes(own) ? own : "en") }) },
            ...LANGS.map((code) => ({ value: code, label: nameOf(code) })),
          ]}
          onChange={(target) => set({ target })}
        />
      </Row>
      <Row icon="cloud" label={t("Anbieter von Ask nutzen")} hint={t("Fehlt das Modell für zwei Sprachen, übersetzt der in Ask eingestellte Anbieter. Der Text geht dann an ihn.")}>
        <Switch label={t("Anbieter von Ask nutzen")} checked={s.translate.provider} onChange={(provider) => set({ provider })} />
      </Row>
    </Group>
  );
}
