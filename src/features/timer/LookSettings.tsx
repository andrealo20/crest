import type { ReactNode } from "react";
import { Group, StyleCards } from "../../ui/controls";
import { settings, updateSettings } from "../../settings/store";
import { Look, clockFace } from "./Look";
import { TIMER_LOOKS, lookLabels, type ClockLook } from "./looks";
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
          onChange={(v) => updateSettings((s) => ({ timer: { ...s.timer, look: v } }))}
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

/** Settings > Timer: the Overview clock in its usual text or in one of the timer looks, previewed at 20:06 on a Sunday. */
export function ClockLookSettings() {
  const clockLook = settings.use().timer.clockLook;
  const face = clockFace(new Date(2026, 10, 1, 20, 6));
  const options: { value: ClockLook; label: string; preview: ReactNode }[] = [
    {
      value: "standard",
      label: t("Standard"),
      preview: <span className="tabular px-1.5 text-[17px] leading-none font-semibold tracking-[-0.03em] text-label">{face.clock?.text}</span>,
    },
    ...TIMER_LOOKS.map((l) => ({
      value: l,
      label: t(lookLabels[l]),
      preview: (
        <span className="flex h-full w-full items-center px-1.5">
          <Look look={l} {...face} running={false} mode="focus" tint="var(--color-label)" h={20} />
        </span>
      ),
    })),
  ];
  return (
    <Group title={t("Uhr-Stil")} id="settings-clock-look">
      <div className="px-3 py-2.5">
        <StyleCards
          label={t("Uhr-Stil")}
          value={clockLook}
          onChange={(v) => updateSettings((s) => ({ timer: { ...s.timer, clockLook: v } }))}
          options={options}
        />
      </div>
    </Group>
  );
}
