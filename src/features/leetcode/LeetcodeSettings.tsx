import { useState } from "react";
import { settings, updateSettings } from "../../settings/store";
import { Button, Group, Row, TextField } from "../../ui/controls";
import { t } from "../../i18n";

/** Settings → Connections → LeetCode: public username for stats. */
export function LeetcodeSettings() {
  const saved = settings.use().leetcode.user;
  const [user, setUser] = useState(saved);

  // Cleans pasted URLs like https://leetcode.com/u/octocat/ -> octocat
  const clean = user
    .trim()
    .replace(/^https?:\/\/leetcode\.com\/(u\/)?/i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "");

  const save = () =>
    updateSettings((s) => ({ leetcode: { ...s.leetcode, user: clean } }));

  return (
    <Group title="LeetCode" id="settings-leetcode">
      <Row icon="person"
        label={t("Nutzername")}
        hint={t(
          "Liest das öffentliche Profil und Einreichungen, einmal pro Stunde",
        )}
      >
        <div className="flex items-center gap-1.5">
          <TextField
            value={user}
            onChange={setUser}
            onSubmit={save}
            placeholder={t("Nutzername")}
            width="w-40"
          />
          {clean !== saved && <Button onClick={save}>{t("Sichern")}</Button>}
        </div>
      </Row>
    </Group>
  );
}
