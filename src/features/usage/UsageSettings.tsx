import { useState } from "react";
import { Reorder } from "motion/react";
import { Check, DotsSixVertical, PencilSimple } from "@phosphor-icons/react";
import { springs } from "../../design/motion";
import type { SecretName, UsageId } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { BrandLogo, brandName } from "../../ui/brands";
import { Group, Row, Switch, TextField } from "../../ui/controls";
import { t } from "../../i18n";
import { SecretRow } from "../settings/SettingsView";
import { NAME_MAX } from "./cards";

const hints: Record<UsageId, string> = {
  claude: "Über die Anmeldung von Claude Code",
  codex: "Über die Anmeldung der Codex CLI",
  gemini: "Über die Anmeldung der Antigravity CLI",
  cursor: "Über die Anmeldung der Cursor-App",
  openrouter: "Guthaben und Ausgaben, mit API-Schlüssel",
  deepseek: "Kontostand, mit API-Schlüssel",
  zai: "Limits des Coding-Plans, mit API-Schlüssel",
};

/** Key sources and their Credential Manager entry; OpenRouter shares the AI chat's key. */
const keys: Partial<Record<UsageId, SecretName>> = { openrouter: "ai.openrouter", deepseek: "usage.deepseek", zai: "usage.zai" };

/** The AI usage cards: drag to reorder, switch to add or remove, pencil to rename. Keys for the API-key sources below. */
export function UsageSettings() {
  const s = settings.use();
  const { order, names } = s.aiUsage;
  const [dragging, setDragging] = useState<UsageId | null>(null);
  const [renaming, setRenaming] = useState<UsageId | null>(null);
  const [draft, setDraft] = useState("");
  const keyed = order.filter((id) => keys[id] && s.usage[id]);

  const commit = () => {
    if (!renaming) return;
    const name = draft.trim().slice(0, NAME_MAX);
    updateSettings((cur) => {
      const next = { ...cur.aiUsage.names };
      if (name && name !== brandName[renaming]) next[renaming] = name;
      else delete next[renaming];
      return { aiUsage: { ...cur.aiUsage, names: next } };
    });
    setRenaming(null);
  };

  return (
    <>
      <Group title={t("AI-Nutzung")} id="settings-usage">
        <Reorder.Group
          as="div"
          axis="y"
          values={order}
          onReorder={(next: UsageId[]) => updateSettings((cur) => ({ aiUsage: { ...cur.aiUsage, order: next } }))}
          className="divide-y divide-separator"
        >
          {order.map((id) => {
            const on = s.usage[id];
            return (
              <Reorder.Item
                key={id}
                value={id}
                as="div"
                transition={springs.snappy}
                onDragStart={() => setDragging(id)}
                onDragEnd={() => setDragging(null)}
                whileDrag={{ scale: 1.02 }}
                className={`group relative flex min-h-11 cursor-grab items-center gap-2.5 px-3 py-1.5 active:cursor-grabbing ${
                  dragging === id ? "z-10 rounded-[10px] bg-elevated shadow-[0_6px_18px_rgb(0_0_0/0.45)]" : ""
                }`}
              >
                <DotsSixVertical size={13} weight="bold" className="-ml-1 shrink-0 text-label-4 transition-colors group-hover:text-label-3" />
                <BrandLogo id={id} size={14} className={`shrink-0 ${on ? "text-label-2" : "text-label-4"}`} />
                <div className="min-w-0 flex-1 select-none">
                  {renaming === id ? (
                    <div onPointerDown={(e) => e.stopPropagation()}>
                      <TextField autoFocus value={draft} onChange={setDraft} onSubmit={commit} placeholder={brandName[id]} width="w-40" />
                    </div>
                  ) : (
                    <div className={`truncate text-body ${on ? "text-label" : "text-label-3"}`}>{names[id] || brandName[id]}</div>
                  )}
                  <div className="truncate text-caption text-label-3">{[names[id] && brandName[id], t(hints[id])].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
                  <button
                    aria-label={renaming === id ? t("Sichern") : t("Umbenennen")}
                    title={renaming === id ? t("Sichern") : t("Umbenennen")}
                    onClick={() => {
                      if (renaming === id) return commit();
                      setDraft(names[id] ?? "");
                      setRenaming(id);
                    }}
                    className={`pressable flex size-6 items-center justify-center rounded-full text-label-3 hover:text-label-2 ${renaming === id ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
                  >
                    {renaming === id ? <Check size={12} weight="bold" /> : <PencilSimple size={12} weight="bold" />}
                  </button>
                  <Switch label={names[id] || brandName[id]} checked={on} onChange={(v) => updateSettings((cur) => ({ usage: { ...cur.usage, [id]: v } }))} />
                </div>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
        <Row
          label={
            <span className="flex items-center gap-2 text-label-3">
              <BrandLogo id="grok" size={14} /> {brandName.grok}
            </span>
          }
          hint={t("xAI bietet keinen Abruf der Abo-Limits")}
        >
          <span className="text-caption text-label-4">{t("Nicht verfügbar")}</span>
        </Row>
      </Group>
      {keyed.length > 0 && (
        <Group title={t("Schlüssel für die AI-Nutzung")}>
          {keyed.map((id) => (
            <SecretRow key={id} name={keys[id]!} label={names[id] || brandName[id]} hint={id === "openrouter" ? t("Derselbe Schlüssel wie im AI-Chat") : undefined} />
          ))}
        </Group>
      )}
    </>
  );
}
