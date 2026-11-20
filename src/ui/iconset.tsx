// The icon set of the active style: every name and prop of @phosphor-icons/react, with the names materialNames.ts maps drawn as
// Material Symbols under the Material style. One named import per icon, never a namespace import: that bundles all of Phosphor.
import { forwardRef, type ReactElement } from "react";
import {
  Airplane as PhAirplane, Alarm as PhAlarm, AppWindow as PhAppWindow, ArrowCircleUp as PhArrowCircleUp,
  ArrowClockwise as PhArrowClockwise, ArrowCounterClockwise as PhArrowCounterClockwise, ArrowDown as PhArrowDown,
  ArrowLineUp as PhArrowLineUp, ArrowRight as PhArrowRight, ArrowSquareOut as PhArrowSquareOut, ArrowUp as PhArrowUp,
  ArrowUpRight as PhArrowUpRight, ArrowsClockwise as PhArrowsClockwise, ArrowsDownUp as PhArrowsDownUp,
  ArrowsInLineHorizontal as PhArrowsInLineHorizontal, ArrowsLeftRight as PhArrowsLeftRight, ArrowsOutSimple as PhArrowsOutSimple,
  BatteryFull as PhBatteryFull, BatteryHigh as PhBatteryHigh, BatteryLow as PhBatteryLow, BatteryWarning as PhBatteryWarning,
  Bed as PhBed, BellSimple as PhBellSimple, BellSimpleSlash as PhBellSimpleSlash, Bluetooth as PhBluetooth, BookOpen as PhBookOpen,
  BoundingBox as PhBoundingBox, Broom as PhBroom, Bug as PhBug, Calculator as PhCalculator, CalendarBlank as PhCalendarBlank,
  CalendarCheck as PhCalendarCheck, Camera as PhCamera, CaretDown as PhCaretDown, CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight, CaretUp as PhCaretUp, CaretUpDown as PhCaretUpDown, ChartDonut as PhChartDonut,
  ChartLineUp as PhChartLineUp, ChatCircle as PhChatCircle, Check as PhCheck, CheckCircle as PhCheckCircle,
  CheckSquare as PhCheckSquare, Checks as PhChecks, CircleNotch as PhCircleNotch, ClipboardText as PhClipboardText,
  Clock as PhClock, ClockClockwise as PhClockClockwise, Cloud as PhCloud, CloudFog as PhCloudFog,
  CloudLightning as PhCloudLightning, CloudMoon as PhCloudMoon, CloudRain as PhCloudRain, CloudSnow as PhCloudSnow,
  CloudSun as PhCloudSun, Code as PhCode, Coffee as PhCoffee, Columns as PhColumns, Copy as PhCopy, Cpu as PhCpu, Crop as PhCrop,
  Crosshair as PhCrosshair, CurrencyDollar as PhCurrencyDollar, DeviceMobile as PhDeviceMobile,
  DotsSixVertical as PhDotsSixVertical, DotsThree as PhDotsThree, DownloadSimple as PhDownloadSimple, Drop as PhDrop,
  EnvelopeSimple as PhEnvelopeSimple, Eye as PhEye, EyeSlash as PhEyeSlash, Eyedropper as PhEyedropper, File as PhFile,
  FileArchive as PhFileArchive, FileAudio as PhFileAudio, FileDoc as PhFileDoc, FilePdf as PhFilePdf, FileText as PhFileText,
  FileVideo as PhFileVideo, FileXls as PhFileXls, FileZip as PhFileZip, Files as PhFiles, FilmStrip as PhFilmStrip,
  Fingerprint as PhFingerprint, Fire as PhFire, Flag as PhFlag, Flame as PhFlame, FlipHorizontal as PhFlipHorizontal,
  Folder as PhFolder, FolderOpen as PhFolderOpen, GameController as PhGameController, Gauge as PhGauge, GearSix as PhGearSix,
  Gift as PhGift, Globe as PhGlobe, GlobeHemisphereWest as PhGlobeHemisphereWest, Hammer as PhHammer, HandWaving as PhHandWaving,
  HardDrives as PhHardDrives, Headphones as PhHeadphones, Heart as PhHeart, House as PhHouse, ImageSquare as PhImageSquare,
  Key as PhKey, Keyboard as PhKeyboard, Leaf as PhLeaf, Lightning as PhLightning, LinkSimple as PhLinkSimple, Lock as PhLock,
  LockOpen as PhLockOpen, LockSimple as PhLockSimple, LockSimpleOpen as PhLockSimpleOpen, MagnifyingGlass as PhMagnifyingGlass,
  MapPin as PhMapPin, Microphone as PhMicrophone, MicrophoneSlash as PhMicrophoneSlash, MicrophoneStage as PhMicrophoneStage,
  Monitor as PhMonitor, Moon as PhMoon, MoonStars as PhMoonStars, Mouse as PhMouse, MusicNote as PhMusicNote,
  MusicNoteSimple as PhMusicNoteSimple, MusicNotesSimple as PhMusicNotesSimple, NavigationArrow as PhNavigationArrow,
  NotePencil as PhNotePencil, NumberSquareOne as PhNumberSquareOne, PaintBrush as PhPaintBrush, Palette as PhPalette,
  Pause as PhPause, PencilSimple as PhPencilSimple, PhoneDisconnect as PhPhoneDisconnect, PictureInPicture as PhPictureInPicture,
  Play as PhPlay, Plug as PhPlug, Plugs as PhPlugs, PlugsConnected as PhPlugsConnected, Plus as PhPlus, Power as PhPower,
  Prohibit as PhProhibit, PushPin as PhPushPin, PushPinSimple as PhPushPinSimple, PuzzlePiece as PhPuzzlePiece, QrCode as PhQrCode,
  Quotes as PhQuotes, Record as PhRecord, Repeat as PhRepeat, RepeatOnce as PhRepeatOnce, Robot as PhRobot,
  RocketLaunch as PhRocketLaunch, Scroll as PhScroll, ShieldCheck as PhShieldCheck, ShoppingCart as PhShoppingCart,
  Shuffle as PhShuffle, SignOut as PhSignOut, SkipBack as PhSkipBack, SkipForward as PhSkipForward,
  SlidersHorizontal as PhSlidersHorizontal, Sparkle as PhSparkle, SpeakerHifi as PhSpeakerHifi, SpeakerHigh as PhSpeakerHigh,
  SpeakerLow as PhSpeakerLow, SpeakerNone as PhSpeakerNone, SpeakerSimpleHigh as PhSpeakerSimpleHigh,
  SpeakerSimpleSlash as PhSpeakerSimpleSlash, SpeakerSlash as PhSpeakerSlash, SpeakerX as PhSpeakerX, SquaresFour as PhSquaresFour,
  Star as PhStar, Stop as PhStop, Sun as PhSun, SunDim as PhSunDim, SunHorizon as PhSunHorizon, Table as PhTable,
  TerminalWindow as PhTerminalWindow, TextAa as PhTextAa, TextAlignLeft as PhTextAlignLeft, Thermometer as PhThermometer,
  Timer as PhTimer, Translate as PhTranslate, Trash as PhTrash, Tray as PhTray, Umbrella as PhUmbrella,
  UploadSimple as PhUploadSimple, User as PhUser, VideoCamera as PhVideoCamera, VideoCameraSlash as PhVideoCameraSlash,
  Wallet as PhWallet, Warning as PhWarning, WarningCircle as PhWarningCircle, Watch as PhWatch, Waveform as PhWaveform,
  WifiHigh as PhWifiHigh, WifiSlash as PhWifiSlash, Wind as PhWind, X as PhX,
  IconBase,
  type Icon,
  type IconWeight,
} from "@phosphor-icons/react";
import { design } from "../design/design";
import { LIGHT, PATHS } from "./material-paths";
import { MATERIAL_NAMES } from "./materialNames";

export * from "@phosphor-icons/react";

/**
 * Phosphor's `Ph` under the Crest style. Under Material, the Material Symbol materialNames.ts gives `name`, drawn by Phosphor's own
 * IconBase so that size, color, mirrored, alt and the rest behave the same: bold is the outline at weight 500, regular the outline at
 * 300, fill the filled shape, and duotone the outline with the filled shape at 20 %, as Phosphor draws it.
 */
function material(Ph: Icon, name: string): Icon {
  const glyph = MATERIAL_NAMES[name];
  const [outline, fill] = PATHS[glyph];
  // The same two paths at every weight, so a change of weight fades one into the other (.icon-fade in global.css, which keeps time
  // with the .pressable around it and stays off under reduced motion), while a CSS transition does not run on mount. A glyph whose
  // fill is its outline draws one path: two copies fading across would dim it halfway.
  const draw = (d: string, shown: number, filled: number) =>
    fill ? (
      <>
        <path d={d} style={{ opacity: shown }} className="icon-fade" />
        <path d={fill} style={{ opacity: filled }} className="icon-fade" />
      </>
    ) : (
      <path d={d} />
    );
  const regular = draw(LIGHT[glyph] ?? outline, 1, 0);
  const weights = new Map<IconWeight, ReactElement>([
    ["thin", regular],
    ["light", regular],
    ["regular", regular],
    ["bold", draw(outline, 1, 0)],
    ["fill", draw(outline, 0, 1)],
    ["duotone", draw(outline, 1, 0.2)],
  ]);
  const C = forwardRef<SVGSVGElement, Parameters<Icon>[0]>((props, ref) =>
    design.use() === "material" ? <IconBase ref={ref} viewBox="0 -960 960 960" {...props} weights={weights} /> : <Ph ref={ref} {...props} />,
  );
  C.displayName = Ph.displayName;
  return C as Icon;
}

export const Airplane = material(PhAirplane, "Airplane");
export const Alarm = material(PhAlarm, "Alarm");
export const AppWindow = material(PhAppWindow, "AppWindow");
export const ArrowCircleUp = material(PhArrowCircleUp, "ArrowCircleUp");
export const ArrowClockwise = material(PhArrowClockwise, "ArrowClockwise");
export const ArrowCounterClockwise = material(PhArrowCounterClockwise, "ArrowCounterClockwise");
export const ArrowDown = material(PhArrowDown, "ArrowDown");
export const ArrowLineUp = material(PhArrowLineUp, "ArrowLineUp");
export const ArrowRight = material(PhArrowRight, "ArrowRight");
export const ArrowSquareOut = material(PhArrowSquareOut, "ArrowSquareOut");
export const ArrowUp = material(PhArrowUp, "ArrowUp");
export const ArrowUpRight = material(PhArrowUpRight, "ArrowUpRight");
export const ArrowsClockwise = material(PhArrowsClockwise, "ArrowsClockwise");
export const ArrowsDownUp = material(PhArrowsDownUp, "ArrowsDownUp");
export const ArrowsInLineHorizontal = material(PhArrowsInLineHorizontal, "ArrowsInLineHorizontal");
export const ArrowsLeftRight = material(PhArrowsLeftRight, "ArrowsLeftRight");
export const ArrowsOutSimple = material(PhArrowsOutSimple, "ArrowsOutSimple");
export const BatteryFull = material(PhBatteryFull, "BatteryFull");
export const BatteryHigh = material(PhBatteryHigh, "BatteryHigh");
export const BatteryLow = material(PhBatteryLow, "BatteryLow");
export const BatteryWarning = material(PhBatteryWarning, "BatteryWarning");
export const Bed = material(PhBed, "Bed");
export const BellSimple = material(PhBellSimple, "BellSimple");
export const BellSimpleSlash = material(PhBellSimpleSlash, "BellSimpleSlash");
export const Bluetooth = material(PhBluetooth, "Bluetooth");
export const BookOpen = material(PhBookOpen, "BookOpen");
export const BoundingBox = material(PhBoundingBox, "BoundingBox");
export const Broom = material(PhBroom, "Broom");
export const Bug = material(PhBug, "Bug");
export const Calculator = material(PhCalculator, "Calculator");
export const CalendarBlank = material(PhCalendarBlank, "CalendarBlank");
export const CalendarCheck = material(PhCalendarCheck, "CalendarCheck");
export const Camera = material(PhCamera, "Camera");
export const CaretDown = material(PhCaretDown, "CaretDown");
export const CaretLeft = material(PhCaretLeft, "CaretLeft");
export const CaretRight = material(PhCaretRight, "CaretRight");
export const CaretUp = material(PhCaretUp, "CaretUp");
export const CaretUpDown = material(PhCaretUpDown, "CaretUpDown");
export const ChartDonut = material(PhChartDonut, "ChartDonut");
export const ChartLineUp = material(PhChartLineUp, "ChartLineUp");
export const ChatCircle = material(PhChatCircle, "ChatCircle");
export const Check = material(PhCheck, "Check");
export const CheckCircle = material(PhCheckCircle, "CheckCircle");
export const CheckSquare = material(PhCheckSquare, "CheckSquare");
export const Checks = material(PhChecks, "Checks");
export const CircleNotch = material(PhCircleNotch, "CircleNotch");
export const ClipboardText = material(PhClipboardText, "ClipboardText");
export const Clock = material(PhClock, "Clock");
export const ClockClockwise = material(PhClockClockwise, "ClockClockwise");
export const Cloud = material(PhCloud, "Cloud");
export const CloudFog = material(PhCloudFog, "CloudFog");
export const CloudLightning = material(PhCloudLightning, "CloudLightning");
export const CloudMoon = material(PhCloudMoon, "CloudMoon");
export const CloudRain = material(PhCloudRain, "CloudRain");
export const CloudSnow = material(PhCloudSnow, "CloudSnow");
export const CloudSun = material(PhCloudSun, "CloudSun");
export const Code = material(PhCode, "Code");
export const Coffee = material(PhCoffee, "Coffee");
export const Columns = material(PhColumns, "Columns");
export const Copy = material(PhCopy, "Copy");
export const Cpu = material(PhCpu, "Cpu");
export const Crop = material(PhCrop, "Crop");
export const Crosshair = material(PhCrosshair, "Crosshair");
export const CurrencyDollar = material(PhCurrencyDollar, "CurrencyDollar");
export const DeviceMobile = material(PhDeviceMobile, "DeviceMobile");
export const DotsSixVertical = material(PhDotsSixVertical, "DotsSixVertical");
export const DotsThree = material(PhDotsThree, "DotsThree");
export const DownloadSimple = material(PhDownloadSimple, "DownloadSimple");
export const Drop = material(PhDrop, "Drop");
export const EnvelopeSimple = material(PhEnvelopeSimple, "EnvelopeSimple");
export const Eye = material(PhEye, "Eye");
export const EyeSlash = material(PhEyeSlash, "EyeSlash");
export const Eyedropper = material(PhEyedropper, "Eyedropper");
export const File = material(PhFile, "File");
export const FileArchive = material(PhFileArchive, "FileArchive");
export const FileAudio = material(PhFileAudio, "FileAudio");
export const FileDoc = material(PhFileDoc, "FileDoc");
export const FilePdf = material(PhFilePdf, "FilePdf");
export const FileText = material(PhFileText, "FileText");
export const FileVideo = material(PhFileVideo, "FileVideo");
export const FileXls = material(PhFileXls, "FileXls");
export const FileZip = material(PhFileZip, "FileZip");
export const Files = material(PhFiles, "Files");
export const FilmStrip = material(PhFilmStrip, "FilmStrip");
export const Fingerprint = material(PhFingerprint, "Fingerprint");
export const Fire = material(PhFire, "Fire");
export const Flag = material(PhFlag, "Flag");
export const Flame = material(PhFlame, "Flame");
export const FlipHorizontal = material(PhFlipHorizontal, "FlipHorizontal");
export const Folder = material(PhFolder, "Folder");
export const FolderOpen = material(PhFolderOpen, "FolderOpen");
export const GameController = material(PhGameController, "GameController");
export const Gauge = material(PhGauge, "Gauge");
export const GearSix = material(PhGearSix, "GearSix");
export const Gift = material(PhGift, "Gift");
export const Globe = material(PhGlobe, "Globe");
export const GlobeHemisphereWest = material(PhGlobeHemisphereWest, "GlobeHemisphereWest");
export const Hammer = material(PhHammer, "Hammer");
export const HandWaving = material(PhHandWaving, "HandWaving");
export const HardDrives = material(PhHardDrives, "HardDrives");
export const Headphones = material(PhHeadphones, "Headphones");
export const Heart = material(PhHeart, "Heart");
export const House = material(PhHouse, "House");
export const ImageSquare = material(PhImageSquare, "ImageSquare");
export const Key = material(PhKey, "Key");
export const Keyboard = material(PhKeyboard, "Keyboard");
export const Leaf = material(PhLeaf, "Leaf");
export const Lightning = material(PhLightning, "Lightning");
export const LinkSimple = material(PhLinkSimple, "LinkSimple");
export const Lock = material(PhLock, "Lock");
export const LockOpen = material(PhLockOpen, "LockOpen");
export const LockSimple = material(PhLockSimple, "LockSimple");
export const LockSimpleOpen = material(PhLockSimpleOpen, "LockSimpleOpen");
export const MagnifyingGlass = material(PhMagnifyingGlass, "MagnifyingGlass");
export const MapPin = material(PhMapPin, "MapPin");
export const Microphone = material(PhMicrophone, "Microphone");
export const MicrophoneSlash = material(PhMicrophoneSlash, "MicrophoneSlash");
export const MicrophoneStage = material(PhMicrophoneStage, "MicrophoneStage");
export const Monitor = material(PhMonitor, "Monitor");
export const Moon = material(PhMoon, "Moon");
export const MoonStars = material(PhMoonStars, "MoonStars");
export const Mouse = material(PhMouse, "Mouse");
export const MusicNote = material(PhMusicNote, "MusicNote");
export const MusicNoteSimple = material(PhMusicNoteSimple, "MusicNoteSimple");
export const MusicNotesSimple = material(PhMusicNotesSimple, "MusicNotesSimple");
export const NavigationArrow = material(PhNavigationArrow, "NavigationArrow");
export const NotePencil = material(PhNotePencil, "NotePencil");
export const NumberSquareOne = material(PhNumberSquareOne, "NumberSquareOne");
export const PaintBrush = material(PhPaintBrush, "PaintBrush");
export const Palette = material(PhPalette, "Palette");
export const Pause = material(PhPause, "Pause");
export const PencilSimple = material(PhPencilSimple, "PencilSimple");
export const PhoneDisconnect = material(PhPhoneDisconnect, "PhoneDisconnect");
export const PictureInPicture = material(PhPictureInPicture, "PictureInPicture");
export const Play = material(PhPlay, "Play");
export const Plug = material(PhPlug, "Plug");
export const Plugs = material(PhPlugs, "Plugs");
export const PlugsConnected = material(PhPlugsConnected, "PlugsConnected");
export const Plus = material(PhPlus, "Plus");
export const Power = material(PhPower, "Power");
export const Prohibit = material(PhProhibit, "Prohibit");
export const PushPin = material(PhPushPin, "PushPin");
export const PushPinSimple = material(PhPushPinSimple, "PushPinSimple");
export const PuzzlePiece = material(PhPuzzlePiece, "PuzzlePiece");
export const QrCode = material(PhQrCode, "QrCode");
export const Quotes = material(PhQuotes, "Quotes");
export const Record = material(PhRecord, "Record");
export const Repeat = material(PhRepeat, "Repeat");
export const RepeatOnce = material(PhRepeatOnce, "RepeatOnce");
export const Robot = material(PhRobot, "Robot");
export const RocketLaunch = material(PhRocketLaunch, "RocketLaunch");
export const Scroll = material(PhScroll, "Scroll");
export const ShieldCheck = material(PhShieldCheck, "ShieldCheck");
export const ShoppingCart = material(PhShoppingCart, "ShoppingCart");
export const Shuffle = material(PhShuffle, "Shuffle");
export const SignOut = material(PhSignOut, "SignOut");
export const SkipBack = material(PhSkipBack, "SkipBack");
export const SkipForward = material(PhSkipForward, "SkipForward");
export const SlidersHorizontal = material(PhSlidersHorizontal, "SlidersHorizontal");
export const Sparkle = material(PhSparkle, "Sparkle");
export const SpeakerHifi = material(PhSpeakerHifi, "SpeakerHifi");
export const SpeakerHigh = material(PhSpeakerHigh, "SpeakerHigh");
export const SpeakerLow = material(PhSpeakerLow, "SpeakerLow");
export const SpeakerNone = material(PhSpeakerNone, "SpeakerNone");
export const SpeakerSimpleHigh = material(PhSpeakerSimpleHigh, "SpeakerSimpleHigh");
export const SpeakerSimpleSlash = material(PhSpeakerSimpleSlash, "SpeakerSimpleSlash");
export const SpeakerSlash = material(PhSpeakerSlash, "SpeakerSlash");
export const SpeakerX = material(PhSpeakerX, "SpeakerX");
export const SquaresFour = material(PhSquaresFour, "SquaresFour");
export const Star = material(PhStar, "Star");
export const Stop = material(PhStop, "Stop");
export const Sun = material(PhSun, "Sun");
export const SunDim = material(PhSunDim, "SunDim");
export const SunHorizon = material(PhSunHorizon, "SunHorizon");
export const Table = material(PhTable, "Table");
export const TerminalWindow = material(PhTerminalWindow, "TerminalWindow");
export const TextAa = material(PhTextAa, "TextAa");
export const TextAlignLeft = material(PhTextAlignLeft, "TextAlignLeft");
export const Thermometer = material(PhThermometer, "Thermometer");
export const Timer = material(PhTimer, "Timer");
export const Translate = material(PhTranslate, "Translate");
export const Trash = material(PhTrash, "Trash");
export const Tray = material(PhTray, "Tray");
export const Umbrella = material(PhUmbrella, "Umbrella");
export const UploadSimple = material(PhUploadSimple, "UploadSimple");
export const User = material(PhUser, "User");
export const VideoCamera = material(PhVideoCamera, "VideoCamera");
export const VideoCameraSlash = material(PhVideoCameraSlash, "VideoCameraSlash");
export const Wallet = material(PhWallet, "Wallet");
export const Warning = material(PhWarning, "Warning");
export const WarningCircle = material(PhWarningCircle, "WarningCircle");
export const Watch = material(PhWatch, "Watch");
export const Waveform = material(PhWaveform, "Waveform");
export const WifiHigh = material(PhWifiHigh, "WifiHigh");
export const WifiSlash = material(PhWifiSlash, "WifiSlash");
export const Wind = material(PhWind, "Wind");
export const X = material(PhX, "X");
// Phosphor's newer name for Alarm, which the notch's alarm notices import: left to `export *`, it would stay Phosphor's under Material.
export const AlarmIcon = Alarm;
