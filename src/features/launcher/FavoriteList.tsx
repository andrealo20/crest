import { useState, type ReactNode } from "react";
import { Reorder } from "motion/react";
import { CaretDown, CaretUp, DotsSixVertical, X } from "@phosphor-icons/react";
import { springs } from "../../design/motion";
import { t } from "../../i18n";
import { moveFavorite, type Favorite } from "./apps";
import { useIcons } from "./store";
import { AppIcon } from "./AppIcon";

/**
 * Pinned apps to put in order (drag, or the arrows from the keyboard) and to remove: the Launcher's favourites, the taskbar's pinned
 * apps. `badge` adds something to a row, by its index (the Launcher's Alt+N).
 */
export function FavoriteList({ favorites, onChange, badge }: { favorites: Favorite[]; onChange: (next: Favorite[]) => void; badge?: (index: number) => ReactNode }) {
  const icons = useIcons(favorites.map((f) => f.id));
  const [dragging, setDragging] = useState<string | null>(null);
  return (
    <Reorder.Group
      as="div"
      axis="y"
      values={favorites.map((f) => f.id)}
      onReorder={(ids: string[]) => onChange(ids.map((id) => favorites.find((f) => f.id === id)!).filter(Boolean))}
      className="divide-y divide-separator"
    >
      {favorites.map((f, i) => (
        <Reorder.Item
          key={f.id}
          value={f.id}
          as="div"
          transition={springs.snappy}
          onDragStart={() => setDragging(f.id)}
          onDragEnd={() => setDragging(null)}
          whileDrag={{ scale: 1.02 }}
          className={`group relative flex h-9 cursor-grab items-center gap-2.5 px-3 active:cursor-grabbing ${
            dragging === f.id ? "z-10 rounded-[10px] bg-elevated shadow-[0_6px_18px_rgb(0_0_0/0.45)]" : ""
          }`}
        >
          <DotsSixVertical size={13} weight="bold" className="-ms-1 text-label-4 transition-colors group-hover:text-label-3" />
          <AppIcon src={icons[f.id]} size={16} />
          <span className="min-w-0 flex-1 truncate text-body text-label select-none">{f.name}</span>
          {badge?.(i)}
          <div onPointerDown={(e) => e.stopPropagation()} className="flex items-center">
            <MoveButton label={t("Nach oben")} disabled={i === 0} onClick={() => onChange(moveFavorite(favorites, i, -1))}>
              <CaretUp size={12} weight="bold" />
            </MoveButton>
            <MoveButton label={t("Nach unten")} disabled={i === favorites.length - 1} onClick={() => onChange(moveFavorite(favorites, i, 1))}>
              <CaretDown size={12} weight="bold" />
            </MoveButton>
          </div>
          <button
            aria-label={t("Lösen")}
            title={t("Lösen")}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onChange(favorites.filter((x) => x.id !== f.id))}
            className="pressable flex size-6 items-center justify-center rounded-full text-label-3 hover:bg-fill-2 hover:text-label-2"
          >
            <X size={12} weight="bold" />
          </button>
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}

/** Keyboard way to reorder (the drag handle needs a mouse). */
export function MoveButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="pressable flex size-6 items-center justify-center rounded-full text-label-3 hover:bg-fill-2 hover:text-label-2 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
