import { AnimatePresence, motion } from "motion/react";
import { content } from "../../design/motion";
import { Segmented } from "../../ui/controls";
import { UnitsPanel } from "./units";
import { CurrencyPanel } from "./currency";
import { HeaderActions } from "../../notch/header";
import { t } from "../../i18n";
import { convertMode, type ConvertMode } from "./mode";

export function ConvertView() {
  const mode = convertMode.use() === "currency" ? "currency" : "units";
  const setMode = (m: ConvertMode) => convertMode.set(m);
  return (
    <div className="flex h-full flex-col px-4 pt-1 pb-1">
      <HeaderActions>
        <Segmented
          id="convert-mode"
          label={t("Converter")}
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "units", label: t("Einheiten") },
            { value: "currency", label: t("Währung") },
          ]}
        />
      </HeaderActions>
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={mode}
            className="absolute inset-0"
            // Opacity alone: the tool opens in the bar's panel too, which animates no blur.
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: content.enter }}
            exit={{ opacity: 0, transition: content.exit }}
          >
            {mode === "units" ? <UnitsPanel /> : <CurrencyPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
