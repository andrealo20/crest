import { isMac } from "../../platform/native";
import { settings, updateSettings } from "../../settings/store";
import { Row, Switch } from "../../ui/controls";
import { t } from "../../i18n";

/** Settings, Display, Presentation mode: Crest out of other apps' screen sharing and recordings (src-tauri sharing.rs). */
export function HideFromSharingRow() {
  const on = settings.use().presentation.hideFromCapture;
  const label = t("Crest vor Bildschirmfreigabe und Aufnahmen verbergen");
  return (
    <Row icon="hide_source"
      label={label}
      hint={
        isMac ? (
          t("Andere Apps zeigen Crest nicht mehr; ab macOS 15 ignorieren manche Freigabe-Apps das, und eine App, die tief im System aufnimmt, sieht es trotzdem")
        ) : (
          <>
            {t("Andere Apps zeigen Crest nicht mehr; eine App, die tief im System aufnimmt, sieht es trotzdem")}
            <span className="mt-1 block">{t("NVIDIA Instant Replay schaltet sich aus, sobald Crest sich aus Aufnahmen heraushält, und bleibt aus, bis du es in der NVIDIA-App wieder einschaltest")}</span>
          </>
        )
      }
    >
      <Switch label={label} checked={on} onChange={(hideFromCapture) => updateSettings((s) => ({ presentation: { ...s.presentation, hideFromCapture } }))} />
    </Row>
  );
}
