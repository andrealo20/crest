import { settings } from "../../settings/store";
import { Button, Group, Row, Switch } from "../../ui/controls";
import { sourceName } from "./sources";
import { setMusic } from "./music";
import { t } from "../../i18n";

/** Settings > Display > Music: lyrics in the closed notch, and undoing a pinned player. */
export function MusicSettings() {
  const music = settings.use().music;
  return (
    <Group title={t("Musik")} id="settings-music">
      <Row label={t("Songtext in der geschlossenen Notch")} hint={t("Zeigt beim Abspielen nur Cover und die aktuelle Zeile, die Notch passt sich jeder Zeile an")}>
        <Switch label={t("Songtext in der geschlossenen Notch")} checked={music.notchLyrics} onChange={(notchLyrics) => setMusic({ notchLyrics })} />
      </Row>
      {music.pinned && (
        <Row label={t("Angehefteter Player")} hint={t("{app} bleibt in der Notch, auch wenn eine andere App spielt", { app: sourceName(music.pinned) })}>
          <Button onClick={() => setMusic({ pinned: null })}>{t("Lösen")}</Button>
        </Row>
      )}
      <Row label={t("Songtexte")} hint={t("Von lrclib.net. Gesendet werden nur Titel, Interpret und Länge, und nur wenn Songtexte an sind.")} />
    </Group>
  );
}
