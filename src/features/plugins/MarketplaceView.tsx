import { useEffect, useState } from "react";
import { ArrowSquareOut, Check, DownloadSimple, MagnifyingGlass, PuzzlePiece, SpinnerGap } from "@phosphor-icons/react";
import { Button, Row, TextField } from "../../ui/controls";
import { t } from "../../i18n";
import { iconFor } from "./icons";
import { plugins, stagePluginFromUrl } from "./store";

export interface CatalogPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  icon: string;
  downloadUrl: string;
  sourceUrl?: string;
  permissions: {
    network: string[];
    storage: boolean;
    notices: boolean;
  };
}

interface Catalog {
  version: number;
  updatedAt: string;
  plugins: CatalogPlugin[];
}

const FALLBACK_CATALOG: Catalog = {
  version: 1,
  updatedAt: "2026-11-06T23:00:00Z",
  plugins: [],
};

const CATALOG_URL = "https://raw.githubusercontent.com/hamsa0x7/crest/main/plugins/catalog.json";

export function MarketplaceView() {
  const installedList = plugins.use();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [installingId, setInstallingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(CATALOG_URL)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: Catalog) => {
        if (active && data?.plugins) setCatalog(data);
      })
      .catch(() => {
        if (active) setCatalog(FALLBACK_CATALOG);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const items = (catalog?.plugins ?? []).filter((p) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.author.toLowerCase().includes(q);
  });

  const handleInstall = async (plugin: CatalogPlugin) => {
    setInstallingId(plugin.id);
    try {
      await stagePluginFromUrl(plugin.downloadUrl);
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <MagnifyingGlass size={14} weight="bold" className="shrink-0 text-label-3" />
        <TextField
          value={query}
          onChange={setQuery}
          placeholder={t("Plugins durchsuchen …")}
          width="flex-1"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-label-3">
          <SpinnerGap size={18} className="animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-caption text-label-3">
          {t("Keine Plugins gefunden")}
        </div>
      ) : (
        items.map((p) => {
          const installed = installedList.find((x) => x.id === p.id);
          const isInstalled = !!installed;
          const hasUpdate = isInstalled && installed.version !== p.version;
          const I = iconFor(p.icon) ?? PuzzlePiece;
          const isBusy = installingId === p.id;

          return (
            <Row
              key={p.id}
              label={
                <span className="flex items-center gap-2">
                  <I size={14} weight="bold" className="shrink-0 text-label-2" />
                  <span>{p.name}</span>
                  <span className="text-label-3">{p.version}</span>
                </span>
              }
              hint={
                <span>
                  {p.description}
                  {p.author && ` · ${p.author}`}
                  {p.permissions.network.length > 0 && ` · ${p.permissions.network.join(", ")}`}
                </span>
              }
            >
              <div className="flex items-center gap-2">
                {p.sourceUrl && (
                  <a
                    href={p.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="pressable rounded-full p-1 text-label-3 hover:text-label-2"
                    title={t("Quellcode")}
                  >
                    <ArrowSquareOut size={13} weight="bold" />
                  </a>
                )}

                {isInstalled && !hasUpdate ? (
                  <span className="flex items-center gap-1 text-caption text-label-3">
                    <Check size={12} weight="bold" className="text-green" />
                    {t("Installiert")}
                  </span>
                ) : (
                  <Button
                    icon={isBusy ? SpinnerGap : DownloadSimple}
                    disabled={isBusy}
                    onClick={() => void handleInstall(p)}
                  >
                    {isBusy ? t("Laden …") : hasUpdate ? t("Aktualisieren") : t("Installieren")}
                  </Button>
                )}
              </div>
            </Row>
          );
        })
      )}
    </div>
  );
}
