import { Group, StyleCards } from "../../ui/controls";
import { settings, updateSettings } from "../../settings/store";
import { Look } from "./Look";
import { TIMER_LOOKS, lookLabels } from "./looks";
import { t } from "../../i18n";

/** Settings > Timer: the look of the big countdown, each card a still preview at 18:24 of 25 min. */
export function TimerLookSettings() {
  const look = settings.use().timer.look;
  return (
    <Group title={t("Timer-Stil")} id="settings-timer-look">
      <div className="px-3 py-2.5">
        <StyleCards
          label={t("Timer-Stil")}
          value={look}
          onChange={(v) => updateSettings({ timer: { look: v } })}
          options={TIMER_LOOKS.map((l) => ({
            value: l,
            label: t(lookLabels[l]),
            preview: (
              <span className="flex h-full w-full items-center px-1.5">
                <Look look={l} remaining={1104} duration={1500} running={false} mode="focus" tint="var(--color-orange)" h={20} />
              </span>
            ),
          }))}
        />
      </div>
    </Group>
  );
}
