import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { content } from "../../design/motion";
import { Segmented } from "../../ui/controls";
import { UnitsPanel } from "./units";
import { CurrencyPanel } from "./currency";
import { HeaderActions } from "../../notch/header";
import { t } from "../../i18n";

type Mode = "units" | "currency";

export function ConvertView() {
  const [mode, setMode] = useState<Mode>("units");
  return (
    <div className="flex h-full flex-col px-4 pt-1 pb-1">
      <HeaderActions>
        <Segmented
          id="convert-mode"
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
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
          >
            {mode === "units" ? <UnitsPanel /> : <CurrencyPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
