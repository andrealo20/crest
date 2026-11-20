import { Airplane, BatteryFull, BatteryHigh, Bluetooth, DeviceMobile, File as FileGlyph, Files, Folder, GameController, Gauge, Headphones, ImageSquare, Keyboard, Leaf, LinkSimple, Lock, LockOpen, Microphone, MicrophoneSlash, Monitor, Moon, Mouse, NumberSquareOne, Plug, SpeakerHifi, SpeakerHigh, SpeakerLow, SpeakerNone, SpeakerX, Sun, SunDim, TextAa, Watch, WifiHigh, WifiSlash, type Icon } from "../../ui/iconset";
import type { StatusAlert } from "./status";

/** The status alerts' icons, for the closed shape (NoticeLayer.tsx) and the side edges (CompactColumn.tsx). */
export const STATUS_ICON: Record<StatusAlert["icon"], Icon> = {
  plug: Plug, battery: BatteryHigh, "battery-full": BatteryFull, wifi: WifiHigh, "wifi-off": WifiSlash, headphones: Headphones,
  "speaker-hifi": SpeakerHifi, mouse: Mouse, keyboard: Keyboard, gamepad: GameController, phone: DeviceMobile, watch: Watch, bluetooth: Bluetooth,
  "speaker-high": SpeakerHigh, "speaker-low": SpeakerLow, "speaker-none": SpeakerNone, "speaker-x": SpeakerX, sun: Sun, "sun-dim": SunDim, lock: Lock, "lock-open": LockOpen, "num-lock": NumberSquareOne, microphone: Microphone, "microphone-slash": MicrophoneSlash,
  // A copy, with the Clipboard tool's icons.
  text: TextAa, link: LinkSimple, image: ImageSquare, file: FileGlyph, files: Files, folder: Folder,
  moon: Moon, leaf: Leaf, gauge: Gauge, airplane: Airplane, monitor: Monitor,
};
